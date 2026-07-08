import { log } from "evlog";
import { priceUsage } from "../provider/cost";
import type { UsageSnapshot, UsageTokens } from "../usage/usage-record";
import type { RunEvent } from "./events";
import type { StreamOutcome } from "./retry-helpers";
import type { SessionRuntimeDeps } from "./runtime";
import type { Message, MessageUsage } from "./types";

const CENTS_PER_DOLLAR = 100;

export interface AgentIdentity {
	modelId: string;
	providerId: string;
}

interface PricedUsage {
	costUsd: number | null;
	priced: boolean;
	usage: MessageUsage | null;
}

async function withCost(
	deps: Pick<SessionRuntimeDeps, "modelCacheStore">,
	agent: AgentIdentity,
	usage: MessageUsage | null
): Promise<PricedUsage> {
	if (usage === null) {
		return { costUsd: null, priced: false, usage: null };
	}
	const entry = await deps.modelCacheStore.get(agent.providerId, agent.modelId);
	const { costUsd, priced } = entry
		? priceUsage(usage, entry)
		: { costUsd: null, priced: false };
	const costCents =
		costUsd === null ? null : Math.round(costUsd * CENTS_PER_DOLLAR);
	return { costUsd, priced, usage: { ...usage, costCents } };
}

export interface FinalizeArgs {
	agent: AgentIdentity;
	assistantId: string;
	fallback: Message;
	outcome: StreamOutcome;
	sessionId: string;
	/** Null for anonymous/system-triggered turns; usage_records requires a
	 * non-null userId (D-1), so those turns skip the dual-write and only get
	 * the legacy `messages.usage` write below. */
	userId: string | null;
}

const ZERO_TOKENS: UsageTokens = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	reasoning: 0,
};

function tokensFromUsage(usage: MessageUsage | null): UsageTokens {
	if (!usage) {
		return ZERO_TOKENS;
	}
	return {
		input: usage.inputTokens ?? 0,
		output: usage.outputTokens ?? 0,
		cacheRead: usage.cacheReadTokens ?? 0,
		cacheWrite: usage.cacheWriteTokens ?? 0,
		reasoning: usage.reasoningTokens ?? 0,
	};
}

// Best-effort dual-write: a usage_records failure must not fail the user's
// turn (the legacy `messages.usage` write above already succeeded), so
// insert errors are logged and swallowed rather than propagated.
async function recordChatUsage(
	deps: Pick<SessionRuntimeDeps, "usageRecordStore">,
	snapshot: UsageSnapshot
): Promise<void> {
	if (!deps.usageRecordStore) {
		return;
	}
	try {
		await deps.usageRecordStore.insert(snapshot);
	} catch (error) {
		log.error({ action: "usage-record insert failed", error: String(error) });
	}
}

export async function* finalizeAssistant(
	deps: Pick<
		SessionRuntimeDeps,
		"messageStore" | "modelCacheStore" | "sessionStore" | "usageRecordStore"
	>,
	args: FinalizeArgs
): AsyncGenerator<RunEvent, Message> {
	const { agent, assistantId, fallback, sessionId, outcome, userId } = args;
	const { usage, costUsd, priced } = await withCost(deps, agent, outcome.usage);
	const final = await deps.messageStore.updateMessage(assistantId, {
		status: outcome.status,
		usage,
		finishReason: outcome.finishReason,
		error: outcome.errorMessage
			? {
					message: outcome.errorMessage,
					category: outcome.errorCategory ?? "fatal",
				}
			: null,
	});
	if (userId !== null) {
		await recordChatUsage(deps, {
			source: "chat",
			userId,
			sessionId,
			providerId: agent.providerId,
			model: agent.modelId,
			costUsd,
			priced,
			tokens: tokensFromUsage(usage),
			dedupKey: `chat:${assistantId}`,
		});
	}
	if (outcome.status === "error") {
		await deps.sessionStore.setStatus(sessionId, "error");
		yield { type: "error", message: outcome.errorMessage ?? "stream error" };
	} else {
		// Reset to active so a session that previously errored recovers.
		await deps.sessionStore.setStatus(sessionId, "active");
		yield {
			type: "done",
			usage,
			finishReason: outcome.finishReason,
		};
	}
	return final ?? fallback;
}
