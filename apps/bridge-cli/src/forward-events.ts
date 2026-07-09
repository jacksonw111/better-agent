// The event-forwarding half of the relay loop: drains an agent's normalized
// events and hands batches off to a `pushEvents` retry queue. Split out of
// relay-client.ts purely to keep that file (and run-bridge-session.ts, which
// uses this) under the repo's max-lines-per-file gate — fully generic over
// `T`, with no `RelayTransport` dependency of its own.

import { createPushQueue, type PushQueue } from "./push-queue";
import { isStaleTurnEvent } from "./turn-stale";

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
