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
import { runDuplexPhase } from "./run-bridge-session-duplex";
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
import type { DuplexChannel } from "./ws-duplex";

// R0-T2: how fast `forwardEvents` flushes a lone leading event once it's
// going out over a live WS push instead of an HTTP poll — see
// `forward-events.ts`'s `leadingEdgeFlush` doc comment for why WS mode wants
// this much lower than the HTTP path's `DEFAULT_FLUSH_INTERVAL_MS`.
const WS_FLUSH_INTERVAL_MS = 25;

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
 * actually stopped both loops.
 *
 * R0-T2: this is the HTTP path, used verbatim (byte-for-byte unchanged) both
 * when the transport has no `openDuplex` at all and when a live channel's
 * FIRST handshake fails — see `runLoops`, the new entry point below, which
 * decides which of this or `runLoopsOverDuplex` to call. */
async function runLoopsOverPoll(args: RunLoopsArgs): Promise<PollOutcome> {
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

/** R0-T2's WS-duplex counterpart to `runLoopsOverPoll` above: `forwardEvents`
 * pushes through `runDuplexPhase`'s hybrid `push` (channel while it's live,
 * HTTP the moment it isn't) instead of calling `pushEvents` directly, and the
 * SECOND half of the `Promise.all` is `runDuplexPhase`'s `outcome` — driven
 * by `channel.onCommand`/`onDown` — instead of `pollLoop` directly (though
 * `pollLoop` still runs, internally, once the channel goes down — see
 * run-bridge-session-duplex.ts). Uses a lower `flushIntervalMs` and leading-
 * edge flush (see `WS_FLUSH_INTERVAL_MS`): trimmed latency matters more than
 * batching efficiency once events go out over a live push instead of a poll. */
async function runLoopsOverDuplex(
	args: RunLoopsArgs,
	channel: DuplexChannel
): Promise<PollOutcome> {
	const { options, sessionId, events, watchdog, afterIdRef, stopPolling } =
		args;
	const sink = watchdogSink(options.handle, watchdog);
	const phase = runDuplexPhase({
		afterIdRef,
		channel,
		pollController: args.pollController,
		pollOptions: options.pollOptions,
		sessionId,
		sink,
		transport: options.transport,
	});
	const [, outcome] = await Promise.all([
		forwardEvents(events, phase.push, {
			flushIntervalMs: WS_FLUSH_INTERVAL_MS,
			leadingEdgeFlush: true,
			...options.forwardOptions,
			signal: options.signal,
			onEvent: (event) => {
				options.forwardOptions?.onEvent?.(event);
				watchdog.observeEvent(event);
			},
		}).finally(() => {
			stopPolling();
			watchdog.dispose();
			channel.close();
		}),
		phase.outcome,
	]);
	return outcome;
}

/** `transport.openDuplex`, made safe to call unconditionally: absent,
 * resolving `null`, or (defensively — the real implementation never does)
 * rejecting all mean the same thing to the caller — no WS channel, fall back
 * to HTTP for this whole generation. */
async function openDuplexChannel(
	options: RunBridgeSessionOptions,
	sessionId: string,
	afterIdRef: AfterIdRef
): Promise<DuplexChannel | null> {
	if (!options.transport.openDuplex) {
		return null;
	}
	try {
		return await options.transport.openDuplex({
			sessionId,
			afterId: afterIdRef.current,
		});
	} catch {
		return null;
	}
}

/** Tries the WS duplex channel first (`openDuplexChannel`); a live one runs
 * `runLoopsOverDuplex`, otherwise `runLoopsOverPoll` runs completely
 * unmodified — see that function's own doc comment for the "byte-for-byte
 * unchanged" guarantee R0-T2's brief requires of the HTTP path. */
async function runLoops(args: RunLoopsArgs): Promise<PollOutcome> {
	const channel = await openDuplexChannel(
		args.options,
		args.sessionId,
		args.afterIdRef
	);
	if (channel) {
		return runLoopsOverDuplex(args, channel);
	}
	return runLoopsOverPoll(args);
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
