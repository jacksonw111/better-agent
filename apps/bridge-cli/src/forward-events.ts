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
	/** RC-fix1: a per-launch generation id, threaded from the caller (see
	 * `restart-loop.ts`'s `generation` counter) and salted into every
	 * idempotency key this call mints. Without it, an in-place restart under
	 * the SAME bridge sessionId (`restart-loop.ts` relaunches the agent but
	 * keeps driving the same session) starts a fresh `forwardEvents` call
	 * whose local `nextEventId` counter resets to 1 — colliding with the
	 * PRIOR generation's still-live keys inside the relay's dedup window
	 * (`redis-relay-store.ts`'s `WINDOW_TTL_SEC`) and silently dropping every
	 * event of the new generation. Left undefined, the key is just the bare
	 * counter (pre-fix1 behavior) — callers that don't care about
	 * cross-restart uniqueness (mostly this file's own tests) don't need to
	 * pass one. Retries of the SAME batch within one call still reuse the
	 * same key: `nextEventId` only advances when a NEW event is buffered, not
	 * on a push-queue resend. */
	generationId?: number;
	/** R0-T2 (WS duplex mode): flush the FIRST event landing in an otherwise
	 * empty/idle buffer immediately, instead of waiting for `flushIntervalMs`
	 * or `maxBatchSize` — trimmed latency matters more than batching
	 * efficiency once events go out over a live WS push instead of an HTTP
	 * poll. A burst of events still batches normally: this only fires the
	 * INSTANT a quiet period ends, not on every event — see `forwardEvents`'s
	 * `leadingFlushArmed` bookkeeping. Left `false`/unset, behavior is
	 * unchanged (the default HTTP path never sets it). */
	leadingEdgeFlush?: boolean;
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

function resolveLeadingEdgeFlush(options: ForwardEventsOptions): boolean {
	return options.leadingEdgeFlush ?? false;
}

/** Mutable per-call bookkeeping `forwardEvents`'s loop mutates directly —
 * bundled into one object so the flush helpers below can be extracted
 * without piling more parameters (or more branches inline in the loop body)
 * onto `forwardEvents` itself, which is what pushed its cyclomatic complexity
 * over the repo's gate once `leadingEdgeFlush` added its own branching. */
interface ForwardState<T> {
	buffer: QueuedEvent<T>[];
	leadingFlushArmed: boolean;
}

/** The flush-interval timer fired: flush whatever's buffered and re-arm (or
 * not) the leading-edge flush for the next quiet-period's first event. */
function applyFlushTick<T>(
	state: ForwardState<T>,
	queue: { enqueue(batch: QueuedEvent<T>[]): void },
	options: ForwardEventsOptions
): void {
	state.buffer = flushToQueue(state.buffer, queue);
	state.leadingFlushArmed = resolveLeadingEdgeFlush(options);
}

/** Just after buffering a newly-arrived event: flush immediately if this is
 * the leading edge of a quiet period, otherwise flush once `maxBatchSize` is
 * reached same as before `leadingEdgeFlush` existed. */
function flushAfterBuffering<T>(
	state: ForwardState<T>,
	queue: { enqueue(batch: QueuedEvent<T>[]): void },
	maxBatchSize: number
): void {
	if (state.leadingFlushArmed && state.buffer.length === 1) {
		state.buffer = flushToQueue(state.buffer, queue);
		state.leadingFlushArmed = false;
		return;
	}
	if (state.buffer.length >= maxBatchSize) {
		state.buffer = flushToQueue(state.buffer, queue);
	}
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
 * `push` — see `QueuedEvent`. A monotonic per-call counter was originally
 * assumed enough (no sessionId prefix needed) on the theory that uniqueness
 * only has to hold across the events one `forwardEvents` call ever produces —
 * but `restart-loop.ts` can call `forwardEvents` MULTIPLE times under the
 * SAME bridge sessionId (an in-place restart relaunches the agent without
 * exiting the process), and each call's counter restarts at 1. RC-fix1:
 * `options.generationId`, when supplied, salts the counter so keys stay
 * unique across those calls while remaining stable across a push-queue retry
 * WITHIN one call (see `QueuedEvent`'s own doc comment).
 */
export async function forwardEvents<T>(
	events: AsyncIterable<T>,
	push: (batch: QueuedEvent<T>[]) => Promise<void>,
	options: ForwardEventsOptions = {}
): Promise<void> {
	const { maxBatchSize, flushIntervalMs, queue, sleep } =
		resolveForwardEventsConfig(options, push);
	const iterator = events[Symbol.asyncIterator]();
	const state: ForwardState<T> = {
		buffer: [],
		// R0-T2: true whenever the NEXT event to land is the first one after a
		// confirmed-idle quiet period (armed initially, and re-armed every time
		// the flush timer actually fires) — see `leadingEdgeFlush`'s doc comment.
		leadingFlushArmed: resolveLeadingEdgeFlush(options),
	};
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
			applyFlushTick(state, queue, options);
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
		const idempotencyKey =
			options.generationId === undefined
				? String(nextEventId++)
				: `${options.generationId}:${nextEventId++}`;
		state.buffer.push({ event: result.value, idempotencyKey });
		flushAfterBuffering(state, queue, maxBatchSize);
	}
	flushToQueue(state.buffer, queue);
	await queue.close();
}
