// A bounded, order-preserving retry queue for shipping batches to the relay
// server. `enqueue` never blocks the producer (`forwardEvents`'s pull loop):
// a background sender drains the queue one batch at a time, retrying a
// failed batch with backoff (mirroring `pollLoop`'s shape) until it succeeds
// before moving on to the next one. That means a transient outage neither
// stalls event collection nor drops events — it just backs the queue up,
// which is why the queue is capped: past `maxBufferedEvents`, the oldest
// queued batch is dropped (and reported via `onWarning`) instead of growing
// without bound.
//
// Retrying is bounded on two axes. First, an aborted session — checked, like
// `pollLoop` checks `options.signal`, right after a failed attempt rather
// than by interrupting an in-flight `push()` or `sleep()` — switches from the
// normal backoff to a short, best-effort flush grace (A3): up to
// `ABORT_FLUSH_MAX_RETRIES` further attempts, budgeted across the WHOLE
// remaining backlog (≈`ABORT_FLUSH_MAX_RETRIES * ABORT_FLUSH_RETRY_MS` wall
// clock in total), so events already collected when the session ends still
// get a real chance to ship instead of being silently discarded — and a batch
// that's abandoned anyway is warned about via `onWarning`, never dropped
// silently. A batch already being attempted always gets that one attempt,
// abort or not, so a session that ends the instant a batch is handed off
// still gives it a fair shot. Second, a batch that keeps failing past
// `MAX_PUSH_RETRIES` is a permanent failure, not a transient one — the queue
// gives up and surfaces it via `fatal` rather than retrying forever against a
// dead server or an expired token (an abort is never fatal, though: aborted
// sessions resolve `close()` quietly).

import {
	bufferedCount,
	type ShedPolicy,
	shedDroppable,
} from "./push-queue-shed";

export type { ShedPolicy } from "./push-queue-shed";

export type Sleep = (ms: number) => Promise<void>;

const PUSH_RETRY_MIN_INTERVAL_MS = 500;
const PUSH_RETRY_MAX_INTERVAL_MS = 5000;
const PUSH_RETRY_BACKOFF_FACTOR = 2;
/** How many attempts a single batch gets before the queue gives up on it and
 * surfaces a fatal error via `fatal` — see the module comment above. */
export const MAX_PUSH_RETRIES = 8;
/** A3: how many post-abort retry attempts the WHOLE queue shares before the
 * remaining backlog is abandoned (each preceded by an
 * `ABORT_FLUSH_RETRY_MS` sleep, so the grace is ≈3s of wall clock in total —
 * a short best-effort flush, not an open-ended retry loop). */
export const ABORT_FLUSH_MAX_RETRIES = 3;
/** Fixed (non-backoff) interval between post-abort grace attempts. */
const ABORT_FLUSH_RETRY_MS = 1000;

export interface PushQueueOptions<T> {
	maxBufferedEvents: number;
	onWarning?: (message: string) => void;
	push: (batch: T[]) => Promise<void>;
	/** A2: when supplied, cap overflow sheds only the droppable class (oldest
	 * first) and enqueues a marker item — see push-queue-shed.ts. Without it,
	 * the legacy whole-oldest-batch drop applies. */
	shedPolicy?: ShedPolicy<T>;
	/** Aborting downgrades a failing batch's retries to the short shared
	 * abort-flush grace — see the module comment. */
	signal?: AbortSignal;
	sleep?: Sleep;
}

export interface PushQueue<T> {
	/** Signals that no more batches will be enqueued, and resolves once every
	 * already-enqueued batch has been successfully pushed. Rejects if a batch
	 * permanently failed (see `fatal`). */
	close(): Promise<void>;
	/** Enqueues a batch for sending. Never rejects and never blocks. */
	enqueue(batch: T[]): void;
	/** Never resolves; rejects the moment a batch exhausts `MAX_PUSH_RETRIES`,
	 * ahead of `close()` ever being called, unlike `close()`'s own rejection.
	 * Race this alongside an upstream producer (e.g. `forwardEvents`'s event
	 * loop) so a fatal push failure surfaces immediately instead of only
	 * being noticed once the caller gets around to draining and closing the
	 * queue. */
	fatal: Promise<never>;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Applies the backlog cap on enqueue: with a `shedPolicy`, the A2
 * class-aware shed (see push-queue-shed.ts); without one, the legacy
 * behavior — drop whole batches from the front of `pending` until it's back
 * within `maxBufferedEvents` (never dropping the sole remaining batch, so a
 * single over-sized batch doesn't get discarded outright). */
function enforceCap<T>(pending: T[][], options: PushQueueOptions<T>): void {
	const { maxBufferedEvents, onWarning, shedPolicy } = options;
	if (shedPolicy) {
		shedDroppable(pending, maxBufferedEvents, shedPolicy, onWarning);
		return;
	}
	let dropped = 0;
	while (bufferedCount(pending) > maxBufferedEvents && pending.length > 1) {
		dropped += pending.shift()?.length ?? 0;
	}
	if (dropped > 0) {
		onWarning?.(
			`bridge: dropped ${dropped} buffered event(s) — push backlog exceeded ${maxBufferedEvents}`
		);
	}
}

/** A3: the shared post-abort retry allowance — ONE per queue, threaded into
 * every `pushWithRetry` call, so the whole remaining backlog's best-effort
 * flush is bounded together instead of per batch. */
interface AbortFlushBudget {
	remaining: number;
}

interface PushAttempt<T> {
	abortBudget: AbortFlushBudget;
	batch: T[];
	onWarning?: (message: string) => void;
	push: (batch: T[]) => Promise<void>;
	signal?: AbortSignal;
	sleep: Sleep;
}

/** One post-abort failure: decides whether the queue's shared grace budget
 * covers another attempt (true — after the fixed grace sleep) or this batch
 * is abandoned (false), which is always warned about, never silent. */
async function consumeAbortGrace<T>(
	attempt: PushAttempt<T>,
	tries: number
): Promise<boolean> {
	const { abortBudget, batch, onWarning, sleep } = attempt;
	if (abortBudget.remaining <= 0 || tries >= MAX_PUSH_RETRIES) {
		onWarning?.(
			`bridge: abandoned a batch of ${batch.length} event(s) after abort — flush grace exhausted`
		);
		return false;
	}
	abortBudget.remaining -= 1;
	await sleep(ABORT_FLUSH_RETRY_MS);
	return true;
}

/** Pushes `batch`, retrying with backoff until it succeeds, the caller's
 * `signal` aborts (which downgrades to the short shared abort-flush grace —
 * see `consumeAbortGrace`), or it has failed `MAX_PUSH_RETRIES` times —
 * whichever comes first. The first attempt always happens regardless of
 * `signal`, so a batch handed off right as a session ends still gets a fair
 * shot; `signal` is only consulted after a failure, to decide whether it's
 * worth backing off and trying again. A persistent outage below the retry
 * bound is the caller's problem to notice via `onWarning`, not a reason to
 * drop events that were already collected; past it, it's the caller's
 * problem to notice via the thrown error (surfaced through
 * `PushQueue.fatal`), because retrying forever against a dead server or an
 * expired token would just hang everything downstream. An abort is never
 * fatal: once the grace is exhausted the batch is abandoned with a warning
 * and the queue keeps resolving cleanly. */
async function pushWithRetry<T>(attempt: PushAttempt<T>): Promise<void> {
	const { batch, push, sleep, onWarning, signal } = attempt;
	let intervalMs = PUSH_RETRY_MIN_INTERVAL_MS;
	for (let tries = 1; tries <= MAX_PUSH_RETRIES; tries++) {
		try {
			await push(batch);
			return;
		} catch (error) {
			if (signal?.aborted) {
				if (await consumeAbortGrace(attempt, tries)) {
					continue;
				}
				return;
			}
			if (tries === MAX_PUSH_RETRIES) {
				throw new Error(
					`bridge: push failed after ${MAX_PUSH_RETRIES} attempts, giving up: ${String(error)}`
				);
			}
			onWarning?.(
				`bridge: push failed, retrying in ${intervalMs}ms: ${String(error)}`
			);
			await sleep(intervalMs);
			intervalMs = Math.min(
				intervalMs * PUSH_RETRY_BACKOFF_FACTOR,
				PUSH_RETRY_MAX_INTERVAL_MS
			);
		}
	}
	// Unreachable: the loop above always returns or throws by the time `tries`
	// reaches MAX_PUSH_RETRIES. Present only so this stays a well-formed
	// `Promise<void>` function under strict lint rules.
	throw new Error("bridge: pushWithRetry exited its retry loop unexpectedly");
}

interface SenderControls {
	abortBudget: AbortFlushBudget;
	isClosed(): boolean;
	waitForWork(): Promise<void>;
}

/** Drains `pending` one batch at a time, retrying each with `pushWithRetry`
 * until it succeeds or (per-batch) the retry bound is exhausted — in which
 * case this rejects, which is what makes `fatal` (and `close()`) reject too.
 * Split out of `createPushQueue` to keep that function's own body small. */
async function runSender<T>(
	pending: T[][],
	options: PushQueueOptions<T>,
	sleep: Sleep,
	controls: SenderControls
): Promise<void> {
	for (;;) {
		// Dequeueing before pushing (rather than peeking) is deliberate: once a
		// batch is picked up, it's "in flight" and must never be visible to
		// `enforceCap` — only the not-yet-attempted backlog is droppable.
		const batch = pending.shift();
		if (!batch) {
			if (controls.isClosed()) {
				return;
			}
			await controls.waitForWork();
			continue;
		}
		await pushWithRetry({
			abortBudget: controls.abortBudget,
			batch,
			push: options.push,
			sleep,
			onWarning: options.onWarning,
			signal: options.signal,
		});
	}
}

export function createPushQueue<T>(options: PushQueueOptions<T>): PushQueue<T> {
	const pending: T[][] = [];
	const sleep = options.sleep ?? defaultSleep;
	let wake: (() => void) | null = null;
	let closed = false;
	let rejectFatal: (error: unknown) => void = () => undefined;
	// A dedicated promise, distinct from `finished` below: it only ever
	// rejects (on a fatal per-batch failure), never resolves — even once the
	// queue aborts or closes cleanly — so it's always safe to race alongside
	// an upstream producer without that producer mistaking "the queue is
	// idle/closed" for "a fatal failure just happened".
	const fatal: Promise<never> = new Promise((_resolve, reject) => {
		rejectFatal = reject;
	});
	fatal.catch(() => undefined); // no-op if nobody ever races `fatal`

	function wakeSender(): void {
		if (wake) {
			const resolve = wake;
			wake = null;
			resolve();
		}
	}

	const waitForWork = () =>
		new Promise<void>((resolve) => {
			wake = resolve;
		});
	const finished = (async () => {
		try {
			await runSender(pending, options, sleep, {
				abortBudget: { remaining: ABORT_FLUSH_MAX_RETRIES },
				isClosed: () => closed,
				waitForWork,
			});
		} catch (error) {
			rejectFatal(error);
			throw error;
		}
	})();
	finished.catch(() => undefined); // no-op if `close()` is never awaited

	return {
		enqueue(batch: T[]): void {
			pending.push(batch);
			enforceCap(pending, options);
			wakeSender();
		},
		close(): Promise<void> {
			closed = true;
			wakeSender();
			return finished;
		},
		fatal,
	};
}
