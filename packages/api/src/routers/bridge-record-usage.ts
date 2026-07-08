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

function asFiniteNumberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

interface TurnUsageDetail {
	/** Claude's own session UUID, forwarded by
	 * `apps/bridge-cli/src/normalize/claude-code.ts`'s `normalizeClaudeResult`
	 * — stable across the CLI push-queue's retries of a batch, unlike the
	 * server-assigned relay `seq`. `undefined` for non-claude bridges or older
	 * CLI builds that don't forward it yet. */
	claudeSessionId: string | undefined;
	costUsd: number | null;
	durationMs: number | undefined;
	/** Finite `num_turns` off the claude result line, if present — combined
	 * with `claudeSessionId` this is the stable identity of the turn (see
	 * `dedupKey` below). `undefined` when missing/non-finite. */
	numTurns: number | undefined;
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
	return {
		costUsd: asFiniteNumberOrUndefined(detail.costUsd) ?? null,
		durationMs: asFiniteNumberOrUndefined(detail.durationMs),
		numTurns: asFiniteNumberOrUndefined(detail.numTurns),
		claudeSessionId: asNonEmptyString(detail.sessionId),
		tokens: parseTokens(detail.usage),
	};
}

interface SnapshotArgs {
	agentKind: UsageSnapshot["agentKind"];
	detail: TurnUsageDetail;
	seq: number;
	sessionId: string;
	userId: string;
}

/** The seq-based key from before U1-T0 — NOT retry-idempotent (the CLI's
 * push-queue re-appends a retried batch at a new relay seq), so this is only
 * a fallback for the (shouldn't-happen-for-claude) case where the turn's own
 * stable identity is missing. */
function fallbackDedupKey(sessionId: string, seq: number): string {
	log.warn({
		action: "bridge pushEvents recordUsage",
		message:
			"turn_usage missing claude sessionId/numTurns — falling back to seq-based dedupKey, not retry-idempotent",
		sessionId,
		seq,
	});
	return `bridge:${sessionId}:${seq}`;
}

/** Stable across the CLI push-queue's retries of a batch: claude's own
 * `(session_id, num_turns)` uniquely identifies a turn, unlike the
 * server-assigned relay `seq` (which changes on retry — see U1-T0/the
 * double-counting bug this fixes). Falls back to the old seq-based key when
 * either piece is missing. */
function buildDedupKey(
	sessionId: string,
	seq: number,
	detail: TurnUsageDetail
): string {
	const { claudeSessionId, numTurns } = detail;
	if (claudeSessionId === undefined || numTurns === undefined) {
		return fallbackDedupKey(sessionId, seq);
	}
	return `bridge:${claudeSessionId}:${numTurns}`;
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
		dedupKey: buildDedupKey(sessionId, seq, detail),
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
