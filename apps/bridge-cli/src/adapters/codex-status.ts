// The codex adapter's `getStatus` implementation, split out of codex.ts to
// keep that file under the repo's 300-line limit. Unlike claude/pi — which
// REQUEST status on demand (an SDK control call / `get_session_stats` RPC) —
// codex's app-server only ever streams `thread/tokenUsage/updated` /
// `thread/status/changed` notifications on its own schedule, so this tracker
// caches the latest of each as they arrive and answers `getStatus` by
// pushing ONE status_snapshot event built from whatever's cached so far,
// synchronously, with no RPC round trip.

import {
	CODEX_THREAD_STATUS_METHOD,
	CODEX_TOKEN_USAGE_METHOD,
	parseCodexThreadStatus,
	parseCodexTokenUsage,
} from "../normalize/codex-status";
import type { NormalizedEvent } from "../normalize/types";
import { fetchCodexQuota } from "./quota/codex-quota";
import { createQuotaCache, type QuotaCache } from "./quota/quota-cache";
import { withTimeout } from "./quota/quota-shared";
import { STATUS_SNAPSHOT_STATUS, type StatusSnapshotDetail } from "./types";

interface EventSink {
	push(event: NormalizedEvent): void;
}

/** R4-T1: mirrors claude-code-status.ts's own `QUOTA_TIMEOUT_MS`/
 * `defaultClaudeQuotaCache` — see those doc comments for the fail-open/
 * caching rationale, identical here. */
const QUOTA_TIMEOUT_MS = 5000;
const defaultCodexQuotaCache: QuotaCache = createQuotaCache(fetchCodexQuota);

/** Mutable cache of the fields codex streams as loose notifications rather
 * than answering on demand (see the module doc) — filled in by
 * `updateCodexStatusCache`, read by `makeCodexGetStatus`.
 *
 * `model` is no longer purely aspirational (R2-T2): no notification in the
 * stream itself carries it, but `codex.ts` now seeds it from the session's
 * persisted startup config at start and keeps it current via `setModel`
 * (see `makeCodexSetModel` in codex-controls.ts) — so by the time a
 * `getStatus` snapshot is taken it reflects the LAST id this session was
 * told to use, not necessarily a value codex itself has echoed back. */
export type CodexStatusCache = Pick<
	StatusSnapshotDetail,
	"contextUsage" | "model" | "running" | "tokens"
>;

/** Creates an empty cache — one per codex session, held in `codex.ts`'s
 * `start` closure and threaded through to both the notification handler and
 * `getStatus`. */
export function createCodexStatusCache(): CodexStatusCache {
	return {};
}

/** Updates `cache` from one notification's method/params — a no-op for any
 * method other than the two status-bearing ones, and for a status-bearing
 * one whose params don't parse (the previous cached value is left as-is
 * rather than cleared, so a malformed update can't blank out a good one).
 * Called from codex.ts's `onNotification`, alongside the existing
 * `normalizeCodex` feed-event mapping. */
export function updateCodexStatusCache(
	cache: CodexStatusCache,
	method: string,
	params: unknown
): void {
	if (method === CODEX_TOKEN_USAGE_METHOD) {
		const usage = parseCodexTokenUsage(params);
		if (usage) {
			cache.tokens = usage.tokens;
			cache.contextUsage = usage.contextUsage;
		}
	} else if (method === CODEX_THREAD_STATUS_METHOD) {
		const running = parseCodexThreadStatus(params);
		if (running !== undefined) {
			cache.running = running;
		}
	}
}

/**
 * R2-T2 item 4: maps a `thread/tokenUsage/updated` notification onto the
 * same `usage_update` status event opencode streams (`UsageUpdateDetail` in
 * `apps/web/src/components/bridge/bridge-session-status.ts`) so the web's
 * usage chip renders for codex too, not just via the on-demand
 * `status_snapshot`. Reuses `parseCodexTokenUsage`'s already-computed
 * `contextUsage` (used/size) — codex's wire carries no cost figure, so
 * `UsageUpdateDetail.cost` is simply omitted rather than guessed (per the
 * brief: "omit unknowables"). `null` for any other method, or one whose
 * params don't parse. */
export function codexUsageUpdateEvent(
	method: string,
	params: unknown
): NormalizedEvent | null {
	if (method !== CODEX_TOKEN_USAGE_METHOD) {
		return null;
	}
	const usage = parseCodexTokenUsage(params);
	if (!usage?.contextUsage) {
		return null;
	}
	const { used, size } = usage.contextUsage;
	return { kind: "status", status: "usage_update", detail: { used, size } };
}

/** Builds the `AgentHandle.getStatus` implementation: pushes ONE
 * `status_snapshot` event carrying whatever's in `cache` right now — no RPC
 * round trip, unlike pi/claude — plus the account's quota (R4-T1), guarded
 * by `QUOTA_TIMEOUT_MS` via the shared `quotaCache`. Fire-and-forget (the
 * method itself returns synchronously; the push happens once the quota race
 * settles). `quotaCache` defaults to the process-wide cache; tests pass a
 * fake so no real fs/network call happens. */
export function makeCodexGetStatus(
	cache: CodexStatusCache,
	events: EventSink,
	quotaCache: QuotaCache = defaultCodexQuotaCache
): () => void {
	return () => {
		withTimeout(quotaCache.get(), QUOTA_TIMEOUT_MS, undefined).then((quota) => {
			events.push({
				kind: "status",
				status: STATUS_SNAPSHOT_STATUS,
				detail: {
					model: cache.model,
					running: cache.running,
					tokens: cache.tokens,
					contextUsage: cache.contextUsage,
					quota,
				},
			});
		});
	};
}
