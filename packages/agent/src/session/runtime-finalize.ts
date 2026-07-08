import { priceUsage } from "../provider/cost";
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
}

export async function* finalizeAssistant(
	deps: Pick<
		SessionRuntimeDeps,
		"messageStore" | "modelCacheStore" | "sessionStore"
	>,
	args: FinalizeArgs
): AsyncGenerator<RunEvent, Message> {
	const { agent, assistantId, fallback, sessionId, outcome } = args;
	// costUsd/priced are exposed here (unused for now) for Task 3/4's
	// usage_records dual-write; only `usage.costCents` is persisted below.
	const { usage } = await withCost(deps, agent, outcome.usage);
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
