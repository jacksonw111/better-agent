// The relay loop: forwards an agent's normalized events to the server in
// batches, and polls the server for user commands to feed back to the agent.
// Both halves are pure functions over an injected `RelayTransport` (and, for
// `forwardEvents`, an injected `sleep`) so they're fully testable without a
// real network or a real timer — see relay-client.test.ts.

import type { AgentStartConfig } from "./adapters/types";
import {
	type AgentSessionIdRef,
	captureAgentSessionId,
} from "./capture-agent-session-id";
import type { AfterIdRef, CommandSink, RelayEvent } from "./commands";
import { type PollLoopOptions, type PollOutcome, pollLoop } from "./poll-loop";
import { createPushQueue, type PushQueue } from "./push-queue";
import { truncateEvents } from "./truncate-event";
import { isStaleTurnEvent } from "./turn-stale";

export type { AgentSessionIdRef } from "./capture-agent-session-id";
export { type PollOutcome, pollLoop } from "./poll-loop";

/** The subset of the `bridge:` oRPC router this CLI calls. */
export interface RelayTransport {
	/** Re-fetches the calling bridge token's current persisted startup config
	 * (the same shape `startSession`'s `config` returns) — what a restarting
	 * CLI calls instead of `startSession` again, since minting a new session
	 * would break the seamless reconnect a restart is for (see
	 * `restart-loop.ts`). */
	fetchConfig(): Promise<{ config: AgentStartConfig | null }>;
	pollCommands(input: {
		afterId: number;
		sessionId: string;
	}): Promise<RelayEvent[]>;
	pushEvents(input: {
		sessionId: string;
		events: unknown[];
		/** T1 (docs/remote-control-redesign-plan.md): client-minted, index-aligned
		 * with `events` — see `QueuedEvent`. Stable across a push-queue retry of
		 * the same batch, so the relay can dedup a resend whose ack was lost. */
		idempotencyKeys?: string[];
	}): Promise<void>;
	startSession(input: {
		agentKind: string;
		label?: string;
	}): Promise<{ config: AgentStartConfig | null; sessionId: string }>;
}

export type Sleep = (ms: number) => Promise<void>;

const DEFAULT_MAX_BATCH_SIZE = 25;
const DEFAULT_FLUSH_INTERVAL_MS = 250;
// How many events `forwardEvents` will hold in `pushEvents` retry backlog
// before dropping the oldest ones (see push-queue.ts) — generously above
// DEFAULT_MAX_BATCH_SIZE so a handful of consecutive push failures don't
// start shedding events, while still bounding memory during a real outage.
const DEFAULT_MAX_BUFFERED_EVENTS = 1000;
const FLUSH_TICK = Symbol("flush-tick");

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ForwardEventsOptions {
	flushIntervalMs?: number;
	maxBatchSize?: number;
	maxBufferedEvents?: number;
	/** Debug hook: called for every event drained from the agent, before it's
	 * batched and pushed. Lets `--debug` show exactly what the agent produced. */
	onEvent?: (event: unknown) => void;
	onWarning?: (message: string) => void;
	/** Sleep implementation for `pushEvents` retry backoff. Defaults to
	 * `sleep` — split out so tests can control the flush-interval timer and
	 * the retry backoff independently (they're unrelated timers that happen
	 * to share a default implementation). */
	pushRetrySleep?: Sleep;
	/** Aborting stops the `pushEvents` retry queue from retrying (or waiting on
	 * more events) promptly, and rejects this call — see push-queue.ts. */
	signal?: AbortSignal;
	/** Sleep implementation for the flush-interval timer. */
	sleep?: Sleep;
}

/** T1 (docs/remote-control-redesign-plan.md): an event paired with the
 * idempotency key `forwardEvents` mints for it ONCE, at buffer time — before
 * it's ever handed to the `pushEvents` retry queue. Because `push-queue.ts`
 * resends the exact same batch array on retry (never rebuilding it), the key
 * is naturally stable across retries without any extra bookkeeping: mint
 * once, reuse on every resend of that batch. */
export interface QueuedEvent<T> {
	event: T;
	idempotencyKey: string;
}

/** Enqueues `buffer` on `queue` if non-empty, returning the (now-empty) next buffer. */
function flushToQueue<T>(
	buffer: T[],
	queue: { enqueue(batch: T[]): void }
): T[] {
	if (buffer.length === 0) {
		return buffer;
	}
	queue.enqueue(buffer);
	return [];
}

/** Applies `ForwardEventsOptions` defaults and builds the `pushEvents` retry
 * queue. Split out of `forwardEvents` purely to keep that function's
 * cyclomatic complexity low — the defaulting itself has no interesting
 * branching of its own. */
function resolveForwardEventsConfig<T>(
	options: ForwardEventsOptions,
	push: (batch: T[]) => Promise<void>
): {
	flushIntervalMs: number;
	maxBatchSize: number;
	queue: PushQueue<T>;
	sleep: Sleep;
} {
	const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
	const maxBufferedEvents =
		options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
	const sleep = options.sleep ?? defaultSleep;
	const pushRetrySleep = options.pushRetrySleep ?? sleep;
	const queue = createPushQueue<T>({
		maxBufferedEvents,
		onWarning: options.onWarning,
		push,
		signal: options.signal,
		sleep: pushRetrySleep,
	});
	return { flushIntervalMs, maxBatchSize, queue, sleep };
}

/**
 * Drains `events` and hands batches off to a `pushEvents` retry queue: either
 * as soon as `maxBatchSize` items are buffered, or after `flushIntervalMs` of
 * no new event (so a slow trickle of events still ships promptly). A batch
 * that fails to push is retried with backoff in the background instead of
 * blocking (or losing) the next batch — see push-queue.ts. Resolves once
 * `events` completes and every batch (including the trailing partial one)
 * has been successfully pushed; rejects immediately if a batch permanently
 * fails to push (see `PushQueue.fatal`) instead of waiting for `events` to
 * complete first.
 *
 * T1 (docs/remote-control-redesign-plan.md): each drained event is stamped
 * with an idempotency key exactly once, right here, before it ever reaches
 * `push` — see `QueuedEvent`. A monotonic per-call counter is enough (no
 * sessionId prefix needed): the relay dedups within a (sessionId, dir)
 * channel, so uniqueness only has to hold across the events one
 * `forwardEvents` call ever produces.
 */
export async function forwardEvents<T>(
	events: AsyncIterable<T>,
	push: (batch: QueuedEvent<T>[]) => Promise<void>,
	options: ForwardEventsOptions = {}
): Promise<void> {
	const { maxBatchSize, flushIntervalMs, queue, sleep } =
		resolveForwardEventsConfig(options, push);
	const iterator = events[Symbol.asyncIterator]();
	let buffer: QueuedEvent<T>[] = [];
	let nextEventId = 1;
	// Hold ONE outstanding iterator.next() across flush ticks. Re-calling next()
	// every loop iteration (racing it against the flush timer) orphaned the
	// still-pending call whenever the timer won first — so an event that arrived
	// during an idle stretch resolved a next() nobody was awaiting and was lost.
	// With a slow source (claude's ~4s first token) every event fell into that
	// gap and nothing was ever forwarded. Only advance to a new next() after the
	// current one yields a value.
	let pendingNext = iterator.next();
	// RC-T3: the highest turnEpoch forwarded so far — anything stamped lower
	// (a straggler from a superseded turn) is dropped in isStaleTurnEvent
	// instead of ever reaching `push`, one place covering every adapter.
	const highestTurnEpoch = { epoch: 0 };

	for (;;) {
		const tick = sleep(flushIntervalMs).then(() => FLUSH_TICK);
		const next = await Promise.race([pendingNext, tick, queue.fatal]);
		if (next === FLUSH_TICK) {
			buffer = flushToQueue(buffer, queue);
			continue;
		}
		const result = next as IteratorResult<T>;
		if (result.done) {
			break;
		}
		pendingNext = iterator.next();
		if (isStaleTurnEvent(result.value, highestTurnEpoch)) {
			options.onWarning?.(
				"forwardEvents: dropped a straggler event from a superseded turn"
			);
			continue;
		}
		options.onEvent?.(result.value);
		buffer.push({ event: result.value, idempotencyKey: String(nextEventId++) });
		if (buffer.length >= maxBatchSize) {
			buffer = flushToQueue(buffer, queue);
		}
	}
	flushToQueue(buffer, queue);
	await queue.close();
}

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
}

/**
 * Starts a session, then runs the push and poll loops concurrently until
 * either `signal` aborts (caller asked to stop, e.g. SIGINT) or the agent's
 * event stream completes (the agent process exited) — whichever comes
 * first stops the other loop too, so a natural agent exit doesn't leave the
 * poll loop running forever. `handle.stop()` always runs before this
 * function returns or throws — on any exit path — so a failure here (e.g.
 * `startSession` rejecting) never orphans the spawned agent process.
 *
 * The returned `outcome` (see `PollOutcome`) lets the caller — `main`'s
 * outer restart loop (`restart-loop.ts`) — tell a server-issued `stop` apart
 * from a `restart` apart from the agent simply exiting on its own, WITHOUT
 * this function itself knowing anything about relaunching.
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

		let events: AsyncIterable<unknown> = truncateEvents(options.handle.events);
		if (options.agentSessionIdRef) {
			events = captureAgentSessionId(events, options.agentSessionIdRef);
		}

		let outcome: PollOutcome;
		try {
			[, outcome] = await Promise.all([
				forwardEvents(
					events,
					(batch) =>
						options.transport.pushEvents({
							sessionId,
							events: batch.map((item) => item.event),
							idempotencyKeys: batch.map((item) => item.idempotencyKey),
						}),
					{ ...options.forwardOptions, signal: options.signal }
				).finally(stopPolling),
				pollLoop(options.transport, sessionId, options.handle, afterIdRef, {
					...options.pollOptions,
					signal: pollController.signal,
				}),
			]);
		} finally {
			options.signal.removeEventListener("abort", stopPolling);
		}

		return { outcome, sessionId };
	} finally {
		options.handle.stop();
	}
}
