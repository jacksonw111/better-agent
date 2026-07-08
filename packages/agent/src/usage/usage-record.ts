// Shared usage-record type, self-contained (no imports back into the rest of
// @better-agent/agent) to avoid a circular type-only dependency. Later tasks
// (dual-write into `usage_records`) build a store port around this shape;
// this task only introduces the type.

/** Per-kind token counts for a single usage snapshot. All fields are counts
 * (never null) — callers coalesce missing provider fields to 0 before
 * building a snapshot. */
export interface UsageTokens {
	cacheRead: number;
	/** = cache creation. */
	cacheWrite: number;
	input: number;
	output: number;
	reasoning: number;
}

/** A single billable unit of agent usage, ready to persist to
 * `usage_records`. Covers both first-party chat sessions and local/bridge
 * agent runs. */
export interface UsageSnapshot {
	agentKind?: string;
	/** USD, null when `priced` is false (pricing unknown for this model). */
	costUsd: number | null;
	/** Unique; prevents double-counting the same event across retries/replays. */
	dedupKey: string;
	durationMs?: number;
	model?: string;
	priced: boolean;
	providerId?: string;
	sessionId: string;
	source: "chat" | "bridge";
	tokens: UsageTokens;
	userId: string;
}
