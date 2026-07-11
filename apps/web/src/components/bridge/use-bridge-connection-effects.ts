import type { Dispatch, MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BridgeTransport } from "./bridge-transport";
import type { ConnectionAction, ConnectionState } from "./terminal-connection";
import type { FeedAction } from "./use-bridge-feed";

const POLL_INTERVAL_MS = 2000;
// How often the poll fallback retries an SSE upgrade while degraded (see
// `attemptSseRecovery`) — failures here never accumulate toward
// MAX_SSE_FAILURES (terminal-connection.ts), so it just retries forever.
const SSE_RECOVERY_INTERVAL_MS = 30_000;
// Stable sonner ids: a rerun of the degrade/recovery effect updates the
// existing toast in place instead of stacking a duplicate.
const DEGRADED_TOAST_ID = "bridge-connection-degraded";
const RECOVERED_TOAST_ID = "bridge-connection-recovered";
const DEGRADED_TOAST_MESSAGE = "实时连接中断，已切换为轮询";
const RECOVERED_TOAST_MESSAGE = "已恢复实时连接";

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
 * Seeds the feed with persisted history (once per session) BEFORE the live
 * SSE/poll connection is allowed to open — see the `enabled` gate the caller
 * (useBridgeTerminal) builds from the returned flag. This ordering isn't
 * just cosmetic: `mergeEvents` tracks a single running high-water mark, not
 * an id set, so if live/poll bumped `maxSeenId` past some id BEFORE history
 * for that same range was merged in, the history rows at or under that mark
 * would be filtered out as "already seen" and silently lost rather than
 * rendered. Loading history first — and waiting for it to land — keeps
 * `maxSeenId` monotonic from the persisted backlog forward, so live only
 * ever adds NEW events on top of it. A history fetch failure is swallowed
 * (logged nowhere, surfaced nowhere): the terminal still works going
 * forward, just without the pre-reload backlog, and the live connection is
 * still allowed to open afterward.
 */
export function useHistorySeed(args: HistorySeedArgs): boolean {
	const { sessionId, transport, dispatchFeed } = args;
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setLoaded(false);
		const seed = async () => {
			try {
				const rows = await transport.history({ sessionId });
				if (cancelled) {
					return;
				}
				dispatchFeed({
					type: "events",
					events: rows.map((row) => ({ id: row.seq, data: row.event })),
				});
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

export interface SseConnectionArgs {
	conn: ConnectionState;
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	/** Whether this session is still eligible for a live connection at all —
	 * `false` once it's ended, so a stale detail page never opens a fresh SSE
	 * connection (or reconnect) against a session nothing is driving anymore. */
	enabled: boolean;
	maxSeenIdRef: MutableRefObject<number>;
	sessionId: string;
	transport: BridgeTransport;
}

/** Owns the live SSE connection: opens it while not degraded to polling, and
 * reopens on every failure (until the connection reducer's threshold flips
 * status to "polling", at which point this effect stops attempting). */
export function useSseConnection(args: SseConnectionArgs): void {
	const {
		sessionId,
		conn,
		enabled,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	} = args;
	// conn.failureCount (not just conn.status) is a dependency on purpose: it's
	// what changes on each retry attempt while status stays "connecting".
	// maxSeenIdRef.current is deliberately excluded (see useMaxSeenIdRef doc) —
	// it's read as a ref, not a reactive dependency, to avoid tearing down and
	// reopening the stream on every event.
	// biome-ignore lint/correctness/useExhaustiveDependencies: conn.failureCount is deliberate (see comment above), maxSeenIdRef.current is deliberately excluded (see useMaxSeenIdRef doc)
	useEffect(() => {
		if (!enabled || conn.status === "polling") {
			return noCleanup;
		}
		const unsubscribe = transport.connectStream({
			sessionId,
			afterId: maxSeenIdRef.current,
			onOpen: () => dispatchConn({ type: "open" }),
			onEvent: (raw) => dispatchFeed({ type: "events", events: [raw] }),
			onError: () => dispatchConn({ type: "error" }),
		});
		return unsubscribe;
	}, [
		sessionId,
		enabled,
		conn.status,
		conn.failureCount,
		transport,
		dispatchFeed,
		dispatchConn,
	]);
}

export interface PollFallbackArgs {
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	/** See `SseConnectionArgs.enabled` — the poll fallback is likewise skipped
	 * once the session has ended. */
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

type SseRecoveryArgs = Omit<PollOnceArgs, "isCancelled">;

/** One SSE upgrade attempt while degraded to polling: reuses the same
 * `maxSeenIdRef` cursor the poll loop has been advancing, so a recovered
 * stream resumes where polling left off instead of replaying from scratch. On
 * success, flips status back to live and shows the recovery toast; on failure
 * it does nothing (no dispatch, no failure count) — the caller's interval
 * just tries again next tick, forever. */
function attemptSseRecovery(args: SseRecoveryArgs): () => void {
	const { sessionId, maxSeenIdRef, transport, dispatchFeed, dispatchConn } =
		args;
	return transport.connectStream({
		sessionId,
		afterId: maxSeenIdRef.current,
		onOpen: () => {
			toast.success(RECOVERED_TOAST_MESSAGE, { id: RECOVERED_TOAST_ID });
			dispatchConn({ type: "open" });
		},
		onEvent: (raw) => dispatchFeed({ type: "events", events: [raw] }),
		onError: () => {
			// stay polling: retried on the next SSE_RECOVERY_INTERVAL_MS tick
		},
	});
}

/** Starts the poll loop and the SSE-recovery timer together, returning a
 * cleanup that stops both plus any in-flight recovery connection. Split out
 * of `usePollFallback`'s effect so that function stays under the repo's
 * max-lines-per-function gate. */
function runPollingSteadyState(args: SseRecoveryArgs): () => void {
	let cancelled = false;
	const poll = () => pollOnce({ ...args, isCancelled: () => cancelled });
	let unsubscribeRecovery: (() => void) | undefined;
	const tryRecovery = () => {
		unsubscribeRecovery?.();
		unsubscribeRecovery = attemptSseRecovery(args);
	};
	poll();
	const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
	const recoveryTimer = setInterval(tryRecovery, SSE_RECOVERY_INTERVAL_MS);
	return () => {
		cancelled = true;
		clearInterval(pollTimer);
		clearInterval(recoveryTimer);
		unsubscribeRecovery?.();
	};
}

/** Degraded steady-state: polls `observe(afterId)` on a fixed interval while
 * status is "polling", plus retries an SSE upgrade every
 * `SSE_RECOVERY_INTERVAL_MS` (see `runPollingSteadyState`). One effect/
 * cleanup owns both, so a status flip to "live" tears down the poll interval,
 * the recovery timer, and any in-flight recovery connection together —
 * `useSseConnection` then opens the live stream fresh, so two SSE connections
 * are never open at once. */
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
		return runPollingSteadyState({
			sessionId,
			maxSeenIdRef,
			transport,
			dispatchFeed,
			dispatchConn,
		});
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
