// Shared usage-record type. Only imports `BridgeAgentKind` from its
// self-contained canonical module (`../bridge-token-ports`, not `../ports`)
// to avoid a circular type-only dependency — `ports.ts` itself re-exports
// `UsageRecordStore` from this file, so importing `../ports` here would cycle.

import type { BridgeAgentKind } from "../bridge-token-ports";

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
	/** Set by the bridge (local-agent) source; omitted for chat. */
	agentKind?: BridgeAgentKind;
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

/** Write-side of the unified token-usage ledger (`usage_records`); shape
 * mirrors `packages/db`'s implementation. Defined here (rather than importing
 * that implementation's type) so `@better-agent/agent` never depends on
 * `@better-agent/db`. */
export interface UsageRecordStore {
	/** Idempotent: a duplicate dedupKey is a no-op (prevents double-counting). */
	insert(snapshot: UsageSnapshot): Promise<void>;
}
