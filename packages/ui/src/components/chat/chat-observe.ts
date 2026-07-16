import type { MessageHistory } from "@jacksonw111/agent-client";
import { useEffect, useRef, useState } from "react";

// ── observing a detached turn ────────────────────────────────────────────────
// Turns run detached on the server (parts persist progressively). After a
// reload there is no local stream, but the trailing assistant message is still
// `streaming`. Instead of polling history on a timer, we RE-ATTACH to the
// running turn's live event stream (userSessions.observe) and refetch the
// persisted history on progress + once when the turn ends — so a finished turn
// settles immediately and an idle client makes zero requests.

/** True when the trailing message is an assistant turn still streaming. */
export function hasRunningTurn(rows: MessageHistory | undefined): boolean {
	const last = rows?.at(-1);
	return Boolean(
		last &&
			last.message.role === "assistant" &&
			last.message.status === "streaming"
	);
}

/** Consumes a session's live turn events (used only as a progress/close signal). */
export type ObserveTurn = (sessionId: string) => AsyncIterable<unknown>;

// Progress events arrive far faster than a useful refetch cadence; this bounds
// history reads while an observed turn streams (the final settle refetch on
// close bypasses it, so completion is always immediate).
const REFETCH_THROTTLE_MS = 1000;

const NOOP_CLEANUP = (): void => {
	// nothing to tear down when not observing
};

// A leading+trailing throttle: fire now if past the window, else schedule the
// trailing edge. Returns the scheduler plus a cancel for any pending timer.
function throttled(fn: () => void): { run: () => void; cancel: () => void } {
	let last = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const run = () => {
		const since = Date.now() - last;
		if (since >= REFETCH_THROTTLE_MS) {
			last = Date.now();
			fn();
		} else if (!timer) {
			timer = setTimeout(() => {
				timer = null;
				last = Date.now();
				fn();
			}, REFETCH_THROTTLE_MS - since);
		}
	};
	return {
		run,
		cancel: () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}

// Subscribe to a running turn's event stream: throttled refetch on progress,
// one immediate refetch when it closes. Returns a cleanup that stops observing.
function subscribeObserve(
	observe: ObserveTurn,
	sessionId: string,
	refetch: () => void,
	setObserving: (v: boolean) => void
): () => void {
	const controller = new AbortController();
	const { run: scheduleRefetch, cancel } = throttled(refetch);
	const pump = async () => {
		try {
			for await (const _event of observe(sessionId)) {
				if (controller.signal.aborted) {
					return;
				}
				setObserving(true);
				scheduleRefetch();
			}
		} finally {
			if (!controller.signal.aborted) {
				cancel();
				refetch(); // final settle: the persisted turn is now terminal
				setObserving(false);
			}
		}
	};
	pump();
	return () => {
		controller.abort();
		cancel();
	};
}

// Re-attach to a running server-side turn via its event stream. Returns whether
// a turn is currently being observed (for the composer's streaming state).
export function useObserveTurn(
	observe: ObserveTurn | undefined,
	sessionId: string,
	enabled: boolean,
	refetch: () => void
): boolean {
	const [observing, setObserving] = useState(false);
	// Held in refs so a re-created agentClient / new refetch closure doesn't
	// re-subscribe every render — re-attach only when sessionId/enabled change.
	const refetchRef = useRef(refetch);
	refetchRef.current = refetch;
	const observeRef = useRef(observe);
	observeRef.current = observe;
	useEffect(() => {
		const fn = observeRef.current;
		if (!(enabled && fn) || sessionId === "") {
			setObserving(false);
			return NOOP_CLEANUP;
		}
		return subscribeObserve(
			fn,
			sessionId,
			() => refetchRef.current(),
			setObserving
		);
	}, [sessionId, enabled]);
	return observing;
}
