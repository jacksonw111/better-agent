import type { Dispatch, MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BridgeTransport } from "./bridge-transport";
import type { ConnectionAction, ConnectionState } from "./terminal-connection";
import type { FeedAction } from "./use-bridge-feed";

const POLL_INTERVAL_MS = 2000;
/** Page size for the history seed's cursor pagination — matches the server's
 * per-call cap (MAX_HISTORY_LIMIT in packages/api/src/routers/bridge.ts). */
export const HISTORY_PAGE_LIMIT = 500;
// Stable sonner id: a rerun of the degrade effect updates the existing toast
// in place instead of stacking a duplicate.
const DEGRADED_TOAST_ID = "bridge-connection-degraded";
const DEGRADED_TOAST_MESSAGE = "实时连接中断，已切换为轮询";

// A useEffect callback must return consistently (always a cleanup function or
// never); biome's formatter also collapses `return undefined;` to a bare
// `return;`, which then trips eslint's consistent-return against a sibling
// `return unsubscribe;`. Returning this shared no-op keeps every path
// returning a function.
function noCleanup(): void {
	// nothing to clean up on this path
}

/** Resets the feed + connection state whenever the selected session changes. */
export function useResetOnSessionChange(
	sessionId: string,
	dispatchFeed: Dispatch<FeedAction>,
	dispatchConn: Dispatch<ConnectionAction>
): void {
	// sessionId isn't read in the body — it's the intentional re-run trigger
	// (switching sessions is exactly when the feed/connection must reset).
	// biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is a deliberate trigger-only dependency, see comment above
	useEffect(() => {
		dispatchFeed({ type: "reset" });
		dispatchConn({ type: "reset" });
	}, [sessionId, dispatchFeed, dispatchConn]);
}

/** A ref mirror of `maxSeenId`, read by the connect/poll effects below without
 * being a dependency of theirs — including it directly would tear down and
 * reopen the SSE connection (or restart the poll interval) on every single
 * event, instead of only on session/status changes. */
export function useMaxSeenIdRef(maxSeenId: number): MutableRefObject<number> {
	const ref = useRef(maxSeenId);
	useEffect(() => {
		ref.current = maxSeenId;
	}, [maxSeenId]);
	return ref;
}

export interface HistorySeedArgs {
	dispatchFeed: Dispatch<FeedAction>;
	sessionId: string;
	transport: BridgeTransport;
}

/**
 * P5-1: after the history rows land, replays whatever the seed window (and a
 * TTL'd-out relay window) can't deliver: still-open approval/question events
 * are injected as `pendingReplay` entries (original payload + seq, deduped
 * against a later live redelivery — see use-bridge-feed-pending.ts), and
 * requests already answered from ANY device fold into the answered maps so a
 * replayed card renders as handled instead of actionable. Runs inside the
 * seed (before `loaded` flips) so the live connection only opens once the
 * feed's replay bookkeeping is in place. Best-effort like the history fetch
 * itself: a failure (or a transport without the endpoint) just skips replay.
 */
async function replayPendingRequests(
	args: HistorySeedArgs,
	isCancelled: () => boolean
): Promise<void> {
	const { sessionId, transport, dispatchFeed } = args;
	if (!transport.pendingRequests) {
		return;
	}
	try {
		const { pending, answered } = await transport.pendingRequests({
			sessionId,
		});
		if (isCancelled()) {
			return;
		}
		for (const entry of answered) {
			if (entry.kind === "approval") {
				dispatchFeed({
					type: "answer",
					requestId: entry.requestId,
					optionId: entry.optionId,
				});
			} else {
				dispatchFeed({
					type: "answerQuestion",
					requestId: entry.requestId,
					answers: entry.answers,
				});
			}
		}
		if (pending.length > 0) {
			dispatchFeed({
				type: "pendingReplay",
				events: pending.map((row) => ({ id: row.seq, data: row.event })),
			});
		}
	} catch {
		// swallowed: the seeded feed still works, just without the replay
	}
}

/** B4 loss fix: the seed pulls the WHOLE persisted backlog via `afterSeq`
 * cursor pagination. A single `history()` call returns only the OLDEST
 * `HISTORY_PAGE_LIMIT` rows (the endpoint lists ascending), while the live
 * relay window only holds the newest 500 — so on a long session everything
 * between those two windows used to vanish permanently, with `maxSeenId`
 * stuck at the old page's tail. Paginating until a short page guarantees
 * `maxSeenId` ends as the highest contiguously-covered seq. Each page is
 * dispatched as it lands (pages are seq-ascending, so merges stay append-only). */
async function seedHistoryPages(
	args: HistorySeedArgs,
	isCancelled: () => boolean
): Promise<void> {
	const { sessionId, transport, dispatchFeed } = args;
	let afterSeq = 0;
	for (;;) {
		const rows = await transport.history({
			sessionId,
			afterSeq,
			limit: HISTORY_PAGE_LIMIT,
		});
		if (isCancelled()) {
			return;
		}
		if (rows.length > 0) {
			dispatchFeed({
				type: "events",
				events: rows.map((row) => ({ id: row.seq, data: row.event })),
			});
		}
		const lastSeq = rows.at(-1)?.seq;
		const exhausted =
			rows.length < HISTORY_PAGE_LIMIT ||
			lastSeq === undefined ||
			lastSeq <= afterSeq;
		if (exhausted) {
			return;
		}
		afterSeq = lastSeq;
	}
}

/**
 * Seeds the feed with persisted history (once per session) BEFORE the live
 * SSE/poll connection is allowed to open — see the `enabled` gate the caller
 * (useBridgeTerminal) builds from the returned flag. This ordering isn't
 * just cosmetic: `mergeEvents`' high-water mark must be seeded from the
 * persisted backlog before live/poll can bump it, so the backlog is never
 * misfiled as "already seen" (the out-of-order ring in event-feed.ts only
 * covers the recent window, not a whole reloaded session). The seed itself
 * paginates the full backlog — see seedHistoryPages. A history fetch failure
 * is swallowed (logged nowhere, surfaced nowhere): the terminal still works
 * going forward, just without the pre-reload backlog, and the live
 * connection is still allowed to open afterward.
 */
export function useHistorySeed(args: HistorySeedArgs): boolean {
	const { sessionId, transport, dispatchFeed } = args;
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setLoaded(false);
		const seed = async () => {
			try {
				// (Rebuilt from the destructured deps rather than passing `args`,
				// so the effect's dependency list stays exactly those three.)
				const seedArgs = { dispatchFeed, sessionId, transport };
				await seedHistoryPages(seedArgs, () => cancelled);
				// P5-1: replay still-open/answered-elsewhere requests before the
				// live connection is allowed to open — see replayPendingRequests.
				await replayPendingRequests(seedArgs, () => cancelled);
			} catch {
				// swallowed: the live SSE/poll paths still deliver going forward
			} finally {
				if (!cancelled) {
					setLoaded(true);
				}
			}
		};
		seed();
		return () => {
			cancelled = true;
		};
	}, [sessionId, transport, dispatchFeed]);
	return loaded;
}

export interface PollFallbackArgs {
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	/** See `SseConnectionArgs.enabled` (use-sse-connection.ts) — the poll
	 * fallback is likewise skipped once the session has ended. */
	enabled: boolean;
	maxSeenIdRef: MutableRefObject<number>;
	sessionId: string;
	status: ConnectionState["status"];
	transport: BridgeTransport;
}

interface PollOnceArgs {
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	isCancelled: () => boolean;
	maxSeenIdRef: MutableRefObject<number>;
	sessionId: string;
	transport: BridgeTransport;
}

/** One `observe(afterId)` round trip, folded into the feed/connection state.
 * Split out of `usePollFallback` purely to keep that effect body short. */
async function pollOnce(args: PollOnceArgs): Promise<void> {
	const {
		sessionId,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
		isCancelled,
	} = args;
	try {
		const events = await transport.observe({
			sessionId,
			afterId: maxSeenIdRef.current,
		});
		if (isCancelled()) {
			return;
		}
		dispatchFeed({ type: "events", events });
		dispatchConn({ type: "polled" });
	} catch {
		// transient poll failure: silently retried on the next tick
	}
}

/** Degraded steady-state: polls `observe(afterId)` on a fixed interval while
 * status is "polling" — the SSE-upgrade retry that used to live here has
 * moved into `useSseConnection` itself (use-sse-connection.ts, R0-T3): a
 * single owner for the SSE connection means a recovery never pays for two
 * live connections, and never flickers live -> connecting right after
 * showing the recovery toast. While that owner's periodic retry is in
 * flight, THIS poll loop keeps running concurrently until it succeeds —
 * `mergeEvents`' maxSeenId dedupe (event-feed.ts:33) is the load-bearing
 * guard that keeps that overlap from delivering (or dropping) anything
 * twice, not any coordination between the two hooks. */
export function usePollFallback(args: PollFallbackArgs): void {
	const {
		sessionId,
		status,
		enabled,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	} = args;
	useEffect(() => {
		if (!enabled || status !== "polling") {
			return noCleanup;
		}
		toast.warning(DEGRADED_TOAST_MESSAGE, { id: DEGRADED_TOAST_ID });
		let cancelled = false;
		const poll = () =>
			pollOnce({
				sessionId,
				maxSeenIdRef,
				transport,
				dispatchFeed,
				dispatchConn,
				isCancelled: () => cancelled,
			});
		poll();
		const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(pollTimer);
		};
	}, [
		sessionId,
		status,
		enabled,
		transport,
		maxSeenIdRef,
		dispatchFeed,
		dispatchConn,
	]);
}
