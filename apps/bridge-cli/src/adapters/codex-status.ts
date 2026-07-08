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
import { STATUS_SNAPSHOT_STATUS, type StatusSnapshotDetail } from "./types";

interface EventSink {
	push(event: NormalizedEvent): void;
}

/** Mutable cache of the fields codex streams as loose notifications rather
 * than answering on demand (see the module doc) — filled in by
 * `updateCodexStatusCache`, read by `makeCodexGetStatus`.
 *
 * ASSUMPTION (unverified, no `codex` binary available in this sandbox): no
 * notification in the stream carries the session's model id, so `model`
 * never gets set today — the field stays here (and on
 * `StatusSnapshotDetail`) for parity with pi/claude and in case a future
 * notification (or `thread/started`) turns out to carry it. */
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

/** Builds the `AgentHandle.getStatus` implementation: pushes ONE
 * `status_snapshot` event carrying whatever's in `cache` right now —
 * fire-and-forget and synchronous (no RPC round trip, unlike pi/claude),
 * matching the `AgentHandle.getStatus` contract in ./types.ts. */
export function makeCodexGetStatus(
	cache: CodexStatusCache,
	events: EventSink
): () => void {
	return () => {
		events.push({
			kind: "status",
			status: STATUS_SNAPSHOT_STATUS,
			detail: {
				model: cache.model,
				running: cache.running,
				tokens: cache.tokens,
				contextUsage: cache.contextUsage,
			},
		});
	};
}
