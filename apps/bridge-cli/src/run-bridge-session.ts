// The session-orchestration half of the relay loop: starts a session, wires
// RC-T5's activity watchdog into it, and runs the push (forward-events.ts)
// and poll (poll-loop.ts) loops concurrently until either stops the other.
// Split out of relay-client.ts purely to keep that file (and this one) under
// the repo's max-lines-per-file gate.

import {
	type AgentSessionIdRef,
	captureAgentSessionId,
} from "./capture-agent-session-id";
import type { AfterIdRef, CommandSink } from "./commands";
import { type ForwardEventsOptions, forwardEvents } from "./forward-events";
import { type PollLoopOptions, type PollOutcome, pollLoop } from "./poll-loop";
import type { RelayTransport } from "./relay-client";
import {
	createSessionWatchdog,
	type SessionWatchdog,
} from "./session-watchdog";
import {
	makeOnStall,
	type WatchdogOutcomeRef,
	watchdogSink,
} from "./session-watchdog-wiring";
import { truncateEvents } from "./truncate-event";

export interface RunBridgeSessionOptions {
	/** See `AgentSessionIdRef`. Optional: only the outer restart loop needs
	 * it, so tests that don't exercise restart can omit it. */
	agentSessionIdRef?: AgentSessionIdRef;
	forwardOptions?: ForwardEventsOptions;
	handle: CommandSink & {
		events: AsyncIterable<unknown>;
		stop(): void;
	};
	/** Fired once the session is registered, before the loops start — lets the
	 * CLI print the session id so the operator sees it connected. */
	onStart?: (sessionId: string) => void;
	pollOptions?: Omit<PollLoopOptions, "signal">;
	/** The already-registered session id — registered BEFORE the adapter starts
	 * so the server can return the token's persisted startup `config` (Phase 4)
	 * in time for `adapter.start` to apply it. The caller owns the
	 * `startSession` round-trip. */
	sessionId: string;
	signal: AbortSignal;
	transport: RelayTransport;
	/** RC-T5: overrides the activity watchdog's silence threshold
	 * (`session-watchdog.ts`'s `STALL_MS`) — tests only; production always
	 * takes the default. */
	watchdogStallMs?: number;
}

/** RC-T5: builds the watchdog for one `runBridgeSession` call, wired to push
 * a "stalled" marker, interrupt the wedged turn, and mark the session for
 * retire the moment it fires (see `session-watchdog-wiring.ts`'s
 * `makeOnStall`). Split out purely to keep `runBridgeSession` under the line
 * gate. */
function buildWatchdog(
	options: RunBridgeSessionOptions,
	sessionId: string,
	outcomeRef: WatchdogOutcomeRef,
	stopPolling: () => void
): SessionWatchdog {
	return createSessionWatchdog({
		stallMs: options.watchdogStallMs,
		onStall: makeOnStall({
			handle: options.handle,
			outcomeRef,
			sessionId,
			stopPolling,
			transport: options.transport,
		}),
	});
}

interface RunLoopsArgs {
	afterIdRef: AfterIdRef;
	events: AsyncIterable<unknown>;
	options: RunBridgeSessionOptions;
	pollController: AbortController;
	sessionId: string;
	stopPolling: () => void;
	watchdog: SessionWatchdog;
}

/** Runs the push (`forwardEvents`) and poll (`pollLoop`) loops concurrently
 * under `watchdog` — the poll loop's `sink` is wrapped (`watchdogSink`) so
 * the watchdog observes turn-start/approval-answered/interrupt, and every
 * forwarded event is also fed to `watchdog.observeEvent` alongside whatever
 * debug `onEvent` hook the caller supplied. Split out of `runBridgeSession`
 * purely to keep that function under the line gate. Returns the RAW
 * `PollOutcome` — `runBridgeSession` overrides it with the watchdog's own
 * `outcomeRef.current` if a stall (not a natural end/server command) is what
 * actually stopped both loops. */
async function runLoops(args: RunLoopsArgs): Promise<PollOutcome> {
	const {
		options,
		sessionId,
		events,
		watchdog,
		afterIdRef,
		pollController,
		stopPolling,
	} = args;
	const [, outcome] = await Promise.all([
		forwardEvents(
			events,
			(batch) =>
				options.transport.pushEvents({
					sessionId,
					events: batch.map((item) => item.event),
					idempotencyKeys: batch.map((item) => item.idempotencyKey),
				}),
			{
				...options.forwardOptions,
				signal: options.signal,
				onEvent: (event) => {
					options.forwardOptions?.onEvent?.(event);
					watchdog.observeEvent(event);
				},
			}
		).finally(() => {
			stopPolling();
			watchdog.dispose();
		}),
		pollLoop(
			options.transport,
			sessionId,
			watchdogSink(options.handle, watchdog),
			afterIdRef,
			{ ...options.pollOptions, signal: pollController.signal }
		),
	]);
	return outcome;
}

/**
 * Starts a session, then runs the push and poll loops concurrently until
 * either `signal` aborts (caller asked to stop, e.g. SIGINT), the agent's
 * event stream completes (the agent process exited), or the RC-T5 activity
 * watchdog fires on a wedged turn — whichever comes first stops the other
 * loop too, so neither a natural agent exit nor a stall leaves the other loop
 * running forever. `handle.stop()` always runs before this function returns
 * or throws — on any exit path — so a failure here (e.g. `startSession`
 * rejecting) never orphans the spawned agent process.
 *
 * The returned `outcome` (see `PollOutcome`) lets the caller — `main`'s
 * outer restart loop (`restart-loop.ts`) — tell a server-issued `stop` apart
 * from a `restart` (which now also covers a watchdog-triggered retire — see
 * `session-watchdog-wiring.ts`) apart from the agent simply exiting on its
 * own, WITHOUT this function itself knowing anything about relaunching.
 */
export async function runBridgeSession(
	options: RunBridgeSessionOptions
): Promise<{ outcome: PollOutcome; sessionId: string }> {
	try {
		const { sessionId } = options;
		options.onStart?.(sessionId);
		const afterIdRef: AfterIdRef = { current: 0 };
		const pollController = new AbortController();
		const stopPolling = () => pollController.abort();
		options.signal.addEventListener("abort", stopPolling);
		if (options.signal.aborted) {
			stopPolling();
		}

		const watchdogOutcome: WatchdogOutcomeRef = {};
		const watchdog = buildWatchdog(
			options,
			sessionId,
			watchdogOutcome,
			stopPolling
		);

		let events: AsyncIterable<unknown> = truncateEvents(options.handle.events);
		if (options.agentSessionIdRef) {
			events = captureAgentSessionId(events, options.agentSessionIdRef);
		}

		let outcome: PollOutcome;
		try {
			outcome = await runLoops({
				afterIdRef,
				events,
				options,
				pollController,
				sessionId,
				stopPolling,
				watchdog,
			});
		} finally {
			options.signal.removeEventListener("abort", stopPolling);
		}

		return { outcome: watchdogOutcome.current ?? outcome, sessionId };
	} finally {
		options.handle.stop();
	}
}
