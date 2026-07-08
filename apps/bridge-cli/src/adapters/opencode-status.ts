// The opencode ACP adapter's `getStatus` implementation, split out of
// opencode.ts to keep that file under the repo's 300-line limit. Mirrors
// codex-status.ts's cache-then-emit model: opencode's ACP layer only ever
// STREAMS its context/cost figure as `usage_update` `session/update`
// notifications (see normalize/opencode-status.ts) — there's no on-demand
// request for it — so this tracker caches the latest and answers `getStatus`
// by pushing ONE status_snapshot event built from whatever's cached so far,
// synchronously, with no RPC round trip.

import { parseOpencodeUsageUpdate } from "../normalize/opencode-status";
import { isRecord, type NormalizedEvent } from "../normalize/types";
import { STATUS_SNAPSHOT_STATUS, type StatusSnapshotDetail } from "./types";

interface EventSink {
	push(event: NormalizedEvent): void;
}

/** ASSUMPTION (unverified, no `opencode` binary available in this sandbox):
 * no ACP notification carries the session's model id, so `model` never gets
 * set today — the field stays here (and on `StatusSnapshotDetail`) for
 * parity with pi/claude/codex and in case a future notification turns out to
 * carry it (mirrors codex-status.ts's identical note). */
export type OpencodeStatusCache = Pick<
	StatusSnapshotDetail,
	"contextUsage" | "costUsd" | "model"
>;

/** Creates an empty cache — one per opencode ACP session, held in
 * `opencode.ts`'s `start` closure and threaded through to both the
 * notification handler and `getStatus`. */
export function createOpencodeStatusCache(): OpencodeStatusCache {
	return {};
}

/** Updates `cache` from one `session/update` notification's params — a no-op
 * for any method other than `session/update`, and for an `update` that isn't
 * a `usage_update` (or doesn't parse as one), leaving the previous cached
 * value as-is rather than clearing it. Called from opencode.ts's own
 * `rpc.onNotification`, alongside the existing event-mapping handler. */
export function updateOpencodeStatusCache(
	cache: OpencodeStatusCache,
	method: string,
	params: unknown
): void {
	if (method !== "session/update" || !isRecord(params)) {
		return;
	}
	const usage = parseOpencodeUsageUpdate(params.update);
	if (usage) {
		cache.contextUsage = usage.contextUsage;
		cache.costUsd = usage.costUsd;
	}
}

/** Builds the `AgentHandle.getStatus` implementation: pushes ONE
 * `status_snapshot` event carrying whatever's in `cache` right now —
 * fire-and-forget and synchronous, matching `makeCodexGetStatus`'s shape. */
export function makeOpencodeGetStatus(
	cache: OpencodeStatusCache,
	events: EventSink
): () => void {
	return () => {
		events.push({
			kind: "status",
			status: STATUS_SNAPSHOT_STATUS,
			detail: {
				model: cache.model,
				costUsd: cache.costUsd,
				contextUsage: cache.contextUsage,
			},
		});
	};
}
