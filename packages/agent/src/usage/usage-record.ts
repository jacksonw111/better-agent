// Shared usage-record type. Self-contained (no imports back into `../ports`)
// to avoid a circular type-only dependency — `ports.ts` itself re-exports
// `UsageRecordStore` from this file.

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
 * `usage_records`. */
export interface UsageSnapshot {
	/** USD, null when `priced` is false (pricing unknown for this model). */
	costUsd: number | null;
	/** Unique; prevents double-counting the same event across retries/replays. */
	dedupKey: string;
	durationMs?: number;
	model?: string;
	priced: boolean;
	providerId?: string;
	sessionId: string;
	source: "chat";
	tokens: UsageTokens;
	userId: string;
}

/** Write-side of the unified token-usage ledger (`usage_records`); shape
 * mirrors `packages/db`'s implementation. Defined here (rather than importing
 * that implementation's type) so `@better-agent/agent` never depends on
 * `@better-agent/db`. */
export interface UsageRecordStore {
	/** Idempotent: a duplicate dedupKey is a no-op (prevents double-counting). */
	insert(snapshot: UsageSnapshot): Promise<void>;
}
