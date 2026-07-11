import type { Dispatch, MutableRefObject } from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import type { BridgeTransport } from "./bridge-transport";
import {
	type ConnectionAction,
	type ConnectionState,
	connectionReducer,
	initialConnectionState,
} from "./terminal-connection";
import type { FeedAction } from "./use-bridge-feed";

// How often `useSseConnection` retries its normal connect while degraded to
// polling (see `runConnectionLoop`) — failures here never accumulate toward
// MAX_SSE_FAILURES (terminal-connection.ts), so it just retries forever.
const SSE_RECOVERY_INTERVAL_MS = 30_000;
// Stable sonner id: a recovery attempt succeeding on a later render updates
// the existing toast in place instead of stacking a duplicate.
const RECOVERED_TOAST_ID = "bridge-connection-recovered";
const RECOVERED_TOAST_MESSAGE = "已恢复实时连接";

// A useEffect callback must return consistently (always a cleanup function or
// never); biome's formatter also collapses `return undefined;` to a bare
// `return;`, which then trips eslint's consistent-return against a sibling
// `return unsubscribe;`. Returning this shared no-op keeps every path
// returning a function.
function noCleanup(): void {
	// nothing to clean up on this path
}

export interface SseConnectionArgs {
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

type SseLoopArgs = Omit<SseConnectionArgs, "enabled">;

/** One connection lifecycle's mutable local state — a shadow of
 * `ConnectionState` owned entirely by `runConnectionLoop`, not read off the
 * external reducer. See that function's doc comment for why. */
interface SseLoopState {
	cancelled: boolean;
	conn: ConnectionState;
	recoveryTimer: ReturnType<typeof setInterval> | undefined;
	unsubscribe: (() => void) | undefined;
}

function stopRecoveryTimer(loop: SseLoopState): void {
	if (loop.recoveryTimer !== undefined) {
		clearInterval(loop.recoveryTimer);
		loop.recoveryTimer = undefined;
	}
}

function startRecoveryTimer(loop: SseLoopState, args: SseLoopArgs): void {
	stopRecoveryTimer(loop);
	loop.recoveryTimer = setInterval(() => {
		attemptConnect(loop, args);
	}, SSE_RECOVERY_INTERVAL_MS);
}

/** A successful `connectStream` open, whether this is the very first attempt
 * or a recovery retry made while degraded: folds into the loop's local
 * state, cancels any recovery timer, and — only when this connection was
 * actually recovering a degraded session — shows the recovery toast. Reusing
 * the SAME connection that just opened is the point of this whole rewrite
 * (R0-T3): nothing here tears it down and reopens a second one. */
function handleOpen(
	loop: SseLoopState,
	dispatchConn: Dispatch<ConnectionAction>
): void {
	if (loop.cancelled) {
		return;
	}
	const wasDegraded = loop.conn.status === "polling";
	loop.conn = connectionReducer(loop.conn, { type: "open" });
	stopRecoveryTimer(loop);
	if (wasDegraded) {
		toast.success(RECOVERED_TOAST_MESSAGE, { id: RECOVERED_TOAST_ID });
	}
	dispatchConn({ type: "open" });
}

/** A failed `connectStream` attempt: while still above the degrade threshold
 * this reconnects immediately (matching the pre-R0-T3 behavior for a normal
 * drop/retry); once it crosses MAX_SSE_FAILURES it switches to the
 * `SSE_RECOVERY_INTERVAL_MS` cadence instead. A failure that happens WHILE
 * already degraded is a recovery attempt, not a fresh failure — it must not
 * dispatch `error` (no failure-count accumulation, see terminal-connection.ts)
 * and just waits for the next timer tick. */
function handleError(loop: SseLoopState, args: SseLoopArgs): void {
	if (loop.cancelled) {
		return;
	}
	if (loop.conn.status === "polling") {
		return;
	}
	loop.conn = connectionReducer(loop.conn, { type: "error" });
	args.dispatchConn({ type: "error" });
	if (loop.conn.status === "polling") {
		startRecoveryTimer(loop, args);
		return;
	}
	attemptConnect(loop, args);
}

/** One `connectStream` call, wired to fold its outcome into the loop's local
 * state via `handleOpen`/`handleError`. */
function attemptConnect(loop: SseLoopState, args: SseLoopArgs): void {
	const { sessionId, maxSeenIdRef, transport, dispatchFeed, dispatchConn } =
		args;
	loop.unsubscribe?.();
	loop.unsubscribe = transport.connectStream({
		sessionId,
		afterId: maxSeenIdRef.current,
		onOpen: () => handleOpen(loop, dispatchConn),
		// The poll fallback (usePollFallback) can still be delivering events on
		// its own 2s interval while THIS recovery attempt is in flight — both
		// write into the same feed reducer during that overlap window.
		// `mergeEvents`' maxSeenId dedupe (event-feed.ts:33) is the load-bearing
		// guard against a duplicate (or dropped) delivery there, not anything
		// in this hook.
		onEvent: (raw) => dispatchFeed({ type: "events", events: [raw] }),
		onError: () => handleError(loop, args),
	});
}

/** Owns one full connection lifecycle for a given (session, enabled) pair:
 * connects immediately, reconnects immediately on failure below
 * MAX_SSE_FAILURES, then — once degraded — keeps retrying the exact same
 * connect every `SSE_RECOVERY_INTERVAL_MS` until one succeeds, all from a
 * single owner. State is tracked in a local `SseLoopState` shadow rather than
 * read off the external `ConnectionState` reducer: reacting to the reducer's
 * committed value directly would mean reacting to changes THIS SAME loop just
 * caused by dispatching `open`/`error` — which is exactly what produced the
 * R0-T3 bug (a recovery probe succeeding, dispatching `open`, and that
 * dispatch's re-render tearing the fresh connection down and opening a
 * second one right behind it). Keeping the deciding state local means a
 * success never triggers a teardown of the connection that just succeeded. */
function runConnectionLoop(args: SseLoopArgs): () => void {
	const loop: SseLoopState = {
		cancelled: false,
		conn: initialConnectionState,
		recoveryTimer: undefined,
		unsubscribe: undefined,
	};
	attemptConnect(loop, args);
	return () => {
		loop.cancelled = true;
		loop.unsubscribe?.();
		stopRecoveryTimer(loop);
	};
}

/** Owns the live SSE connection end-to-end, including its own recovery: see
 * `runConnectionLoop` for the full lifecycle. `usePollFallback` only polls
 * while this is degraded — it no longer probes for an SSE upgrade itself. */
export function useSseConnection(args: SseConnectionArgs): void {
	const {
		sessionId,
		enabled,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	} = args;
	useEffect(() => {
		if (!enabled) {
			return noCleanup;
		}
		return runConnectionLoop({
			sessionId,
			maxSeenIdRef,
			transport,
			dispatchFeed,
			dispatchConn,
		});
	}, [sessionId, enabled, maxSeenIdRef, transport, dispatchFeed, dispatchConn]);
}
