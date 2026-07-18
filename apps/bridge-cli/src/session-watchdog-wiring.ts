// RC-T5: wires session-watchdog.ts's state machine into `runBridgeSession` —
// split out of relay-client.ts purely to keep that file under the repo's
// max-lines-per-file gate, mirrors capture-agent-session-id.ts.

import type { CommandSink } from "./commands";
import type { ImageRef } from "./commands-text-when";
import type { OobPush } from "./oob-push";
import type { PollOutcome } from "./poll-loop";
import type { RelayTransport } from "./relay-client";
import {
	createSessionWatchdog,
	type SessionWatchdog,
	STALLED_STATUS,
} from "./session-watchdog";

/** Pushes the RC-T5 "stalled" marker to the server. A1: with an `oobPush`
 * wired in (production always passes one — see restart-loop.ts), the marker
 * rides the reliable out-of-band channel (retry + idempotency key + warning
 * on final failure); the legacy single fire-and-forget push only remains as
 * the no-`oobPush` fallback for older callers/tests. */
function pushStalledStatus(args: MakeOnStallArgs): void {
	const event = { kind: "status", status: STALLED_STATUS };
	if (args.oobPush) {
		args.oobPush("watchdog", event);
		return;
	}
	args.transport
		.pushEvents({ sessionId: args.sessionId, events: [event] })
		.catch(() => undefined);
}

/** Mutable holder `runBridgeSession` reads back once its `Promise.all`
 * settles — a stall must win over whatever `PollOutcome` `pollLoop` itself
 * returned (almost always `"ended"`, since the watchdog's own reaction below
 * is what unblocks it), so the outer restart loop (restart-loop.ts)
 * relaunches a fresh process instead of the session simply ending. */
export interface WatchdogOutcomeRef {
	current?: PollOutcome;
}

export interface MakeOnStallArgs {
	handle: { interrupt?(): void; stop(): void };
	/** A1: reliable out-of-band channel for the stalled marker — see
	 * `pushStalledStatus`. */
	oobPush?: OobPush;
	outcomeRef: WatchdogOutcomeRef;
	sessionId: string;
	stopPolling: () => void;
	transport: RelayTransport;
}

/** Builds the watchdog's `onStall` reaction: pushes a visible marker,
 * interrupts the wedged turn, marks the session for retire (`outcomeRef`),
 * and tears down + unblocks both loops so `runBridgeSession` returns
 * promptly instead of hanging on a process that's still alive but never
 * produced the turn's terminal event — the outer restart loop then relaunches
 * a fresh one under the SAME bridge sessionId, entirely unmodified. */
export function makeOnStall(args: MakeOnStallArgs): () => void {
	const { handle, outcomeRef, stopPolling } = args;
	return () => {
		pushStalledStatus(args);
		handle.interrupt?.();
		outcomeRef.current = "restart";
		handle.stop();
		stopPolling();
	};
}

/** RC-T5: builds the watchdog for one `runBridgeSession` call, wired to push
 * a "stalled" marker, interrupt the wedged turn, and mark the session for
 * retire the moment it fires (see `makeOnStall`). Moved here from
 * run-bridge-session.ts purely for that file's max-lines gate. */
export function buildWatchdog(
	args: MakeOnStallArgs & { stallMs?: number }
): SessionWatchdog {
	return createSessionWatchdog({
		stallMs: args.stallMs,
		onStall: makeOnStall(args),
	});
}

/** Wraps `handle` so the watchdog observes exactly the signals the forwarded
 * event stream can't give it on its own: a new turn starting (`send`), a
 * pending approval being answered, and an interrupt — routed to
 * `observeTurnEnd`, not `observeApprovalAnswered`, since an interrupt with NO
 * approval open must still stop the clock (the turn is over, the session is
 * now idle awaiting the next `send`); the "approval WAS open, interrupt
 * retracts it" case is covered by the ordering guarantee documented on
 * session-watchdog.ts's `observeApprovalEvent`. */
export function watchdogSink(
	handle: CommandSink,
	watchdog: SessionWatchdog
): CommandSink {
	return {
		...handle,
		answerApproval(requestId: string, optionId: string): void {
			handle.answerApproval(requestId, optionId);
			watchdog.observeApprovalAnswered();
		},
		interrupt(): void {
			watchdog.observeTurnEnd();
			handle.interrupt?.();
		},
		send(text: string, images?: ImageRef[]): void {
			watchdog.observeTurnStart();
			// P3-T2: arity-preserving forward — see dispatchTextCommand's note.
			if (images) {
				handle.send(text, images);
			} else {
				handle.send(text);
			}
		},
	};
}
