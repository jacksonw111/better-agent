import type {
	UsageSnapshot,
	UsageTokens,
} from "@better-agent/agent/usage/usage-record";
import { log } from "evlog";
import type { Context } from "../context";

// Split out of bridge.ts purely to keep that file under the repo's
// max-lines-per-file gate — see bridge-agent-session-id.ts for the same
// pattern. Dual-writes a claude bridge `turn_usage` status event into
// `usage_records` (docs/usage-stats-impl-plan.md §2.3, §T0.5, decision D-4).

const TURN_USAGE_STATUS = "turn_usage";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

interface TurnUsageDetail {
	costUsd: number | null;
	durationMs: number | undefined;
	tokens: UsageTokens;
}

function parseTokens(usage: unknown): UsageTokens {
	const raw = isRecord(usage) ? usage : {};
	return {
		input: asFiniteNumber(raw.input_tokens),
		output: asFiniteNumber(raw.output_tokens),
		cacheRead: asFiniteNumber(raw.cache_read_input_tokens),
		// `cache_creation_input_tokens` (raw claude usage) maps to cacheWrite.
		cacheWrite: asFiniteNumber(raw.cache_creation_input_tokens),
		reasoning: 0,
	};
}

/** Defensively parses a bridge event as a claude `turn_usage` status event
 * (see `apps/bridge-cli/src/normalize/claude-code.ts`'s `normalizeClaudeResult`
 * — `detail.usage` is RAW claude usage in snake_case). Returns `null` for any
 * other event shape (other status kinds, opencode's `usage_update`, plain
 * messages, …), so callers skip it silently — only claude's `turn_usage` is
 * dual-written (decision D-4 defers the others as lossy). */
function parseTurnUsage(event: unknown): TurnUsageDetail | null {
	if (
		!isRecord(event) ||
		event.kind !== "status" ||
		event.status !== TURN_USAGE_STATUS
	) {
		return null;
	}
	const detail = event.detail;
	if (!isRecord(detail)) {
		return null;
	}
	const costUsd =
		typeof detail.costUsd === "number" && Number.isFinite(detail.costUsd)
			? detail.costUsd
			: null;
	const durationMs =
		typeof detail.durationMs === "number" && Number.isFinite(detail.durationMs)
			? detail.durationMs
			: undefined;
	return { costUsd, durationMs, tokens: parseTokens(detail.usage) };
}

interface SnapshotArgs {
	agentKind: UsageSnapshot["agentKind"];
	detail: TurnUsageDetail;
	seq: number;
	sessionId: string;
	userId: string;
}

function buildSnapshot(args: SnapshotArgs): UsageSnapshot {
	const { userId, sessionId, agentKind, seq, detail } = args;
	return {
		source: "bridge",
		userId,
		sessionId,
		agentKind,
		tokens: detail.tokens,
		costUsd: detail.costUsd,
		// claude always reports a USD cost when it emits turn_usage, so a
		// present cost means pricing is known (unlike chat, where `priced`
		// tracks catalog lookup success).
		priced: detail.costUsd !== null,
		durationMs: detail.durationMs,
		dedupKey: `bridge:${sessionId}:${seq}`,
	};
}

export interface RecordBridgeUsageArgs {
	context: Context;
	event: unknown;
	seq: number;
	sessionId: string;
	userId: string;
}

/** Best-effort dual-write of a claude `turn_usage` event into `usage_records`
 * — a failure must not break `pushEvents` (the local agent's live event
 * ingestion), so errors are logged and swallowed. No-ops for any other event
 * shape. */
export async function maybeRecordBridgeUsage(
	args: RecordBridgeUsageArgs
): Promise<void> {
	const { context, event, seq, sessionId, userId } = args;
	const detail = parseTurnUsage(event);
	if (!detail) {
		return;
	}
	try {
		const session = await context.services.stores.bridgeSession.get(sessionId);
		if (!session) {
			return;
		}
		await context.services.stores.usageRecord.insert(
			buildSnapshot({
				userId,
				sessionId,
				agentKind: session.agentKind,
				seq,
				detail,
			})
		);
	} catch (err) {
		log.error({
			action: "bridge pushEvents recordUsage",
			error: String(err),
		});
	}
}
