import { describe, expect, it, vi } from "vitest";
import {
	ABORT_FLUSH_MAX_RETRIES,
	createPushQueue,
	MAX_PUSH_RETRIES,
	type Sleep,
} from "./push-queue";

/** A `sleep` double that resolves immediately — the tests care about retry
 * *ordering* and *counts*, not real backoff timing. */
const instantSleep: Sleep = () => Promise.resolve();

const FAILURES_BEFORE_SUCCESS = 2;
const PERSISTENT_FAILURE_ATTEMPTS = 5;

async function retriesFailingBatchWithoutLosingOrReorderingIt(): Promise<void> {
	const calls: number[][] = [];
	let failuresRemaining = FAILURES_BEFORE_SUCCESS;
	const push = vi.fn((batch: number[]): Promise<void> => {
		calls.push(batch);
		if (failuresRemaining > 0) {
			failuresRemaining -= 1;
			return Promise.reject(new Error("network blip"));
		}
		return Promise.resolve();
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1, 2]);
	queue.enqueue([3, 4]);
	await queue.close();

	// The first batch was attempted three times (two failures then a
	// success) before the second batch was ever attempted, and both batches
	// were eventually delivered, in order.
	expect(calls).toEqual([
		[1, 2],
		[1, 2],
		[1, 2],
		[3, 4],
	]);
}

async function neverDropsAPersistentlyFailingBatch(): Promise<void> {
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		if (attempts < PERSISTENT_FAILURE_ATTEMPTS) {
			return Promise.reject(new Error("still down"));
		}
		return Promise.resolve();
	});
	const onWarning = vi.fn();
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning,
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	await queue.close();

	expect(attempts).toBe(PERSISTENT_FAILURE_ATTEMPTS);
	expect(onWarning).toHaveBeenCalled();
}

async function dropsOldestQueuedBatchButNeverAnInFlightOne(): Promise<void> {
	const firstPushStarted = Promise.withResolvers<void>();
	const releaseFirstPush = Promise.withResolvers<void>();
	let pushCalls = 0;
	const push = vi.fn(async (): Promise<void> => {
		pushCalls += 1;
		if (pushCalls === 1) {
			// Block the sender on the very first batch — deterministically
			// signalling once it's actually in flight — so the following
			// enqueues pile up in the backlog instead of being sent.
			firstPushStarted.resolve();
			await releaseFirstPush.promise;
		}
	});
	const onWarning = vi.fn();
	const queue = createPushQueue<number>({
		maxBufferedEvents: 3,
		onWarning,
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1, 2]);
	await firstPushStarted.promise; // [1, 2] is now in flight, out of the backlog

	queue.enqueue([3, 4]); // backlog: 2
	queue.enqueue([5]); // backlog: 3 (== cap, no drop yet)
	queue.enqueue([6]); // backlog: 4 > cap -> drops the oldest, [3, 4]

	expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("dropped 2"));

	releaseFirstPush.resolve();
	await queue.close();

	// [1, 2] (already in flight when the cap was exceeded) was never at
	// risk of being dropped; [3, 4] (still queued) was.
	expect(push).toHaveBeenNthCalledWith(1, [1, 2]);
	expect(push).toHaveBeenNthCalledWith(2, [5]);
	expect(push).toHaveBeenNthCalledWith(3, [6]);
	expect(push).toHaveBeenCalledTimes(3);
}

async function givesUpAfterMaxRetriesAndRejects(): Promise<void> {
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		return Promise.reject(new Error("still down"));
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning: vi.fn(),
		push,
		sleep: instantSleep,
	});

	queue.enqueue([1]);

	const expectedMessage = `push failed after ${MAX_PUSH_RETRIES} attempts`;
	await expect(queue.close()).rejects.toThrow(expectedMessage);
	// `fatal` settles at the same time as (in fact, just before) `close()`,
	// so it's already rejected by the time `close()` is.
	await expect(queue.fatal).rejects.toThrow(expectedMessage);
	expect(attempts).toBe(MAX_PUSH_RETRIES);
}

async function abortGrantsABoundedFlushGraceThenStopsWithoutRejecting(): Promise<void> {
	const controller = new AbortController();
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		// Abort right after the first attempt fails — long before
		// MAX_PUSH_RETRIES would otherwise be exhausted.
		controller.abort();
		return Promise.reject(new Error("still down"));
	});
	const onWarning = vi.fn();
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning,
		push,
		signal: controller.signal,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	await queue.close(); // resolves — an aborted session isn't a fatal error

	// A3: abort no longer abandons the batch after its first failed attempt —
	// it gets a short best-effort flush grace before the queue gives up, and
	// the abandonment is warned about instead of being silent.
	expect(attempts).toBe(1 + ABORT_FLUSH_MAX_RETRIES);
	expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("abandoned"));
}

async function abortStillDeliversABatchThatRecoversWithinTheGrace(): Promise<void> {
	const controller = new AbortController();
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		if (attempts === 1) {
			controller.abort();
			return Promise.reject(new Error("blip during teardown"));
		}
		return Promise.resolve();
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		push,
		signal: controller.signal,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	await queue.close();

	// The abort-grace retry delivered the batch instead of dropping it.
	expect(attempts).toBe(2);
}

async function abortGraceIsSharedAcrossTheWholeRemainingBacklog(): Promise<void> {
	const controller = new AbortController();
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		controller.abort();
		return Promise.reject(new Error("still down"));
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning: vi.fn(),
		push,
		signal: controller.signal,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	queue.enqueue([2]);
	await queue.close();

	// The grace budget bounds the WHOLE post-abort drain (≈3s wall clock), not
	// each batch separately: batch 1 spends the entire budget (1 attempt +
	// ABORT_FLUSH_MAX_RETRIES), batch 2 still gets its guaranteed first
	// attempt but no further grace retries.
	expect(attempts).toBe(1 + ABORT_FLUSH_MAX_RETRIES + 1);
}

async function abortBeforeFinalAttemptFailsResolvesWithoutFatalRejection(): Promise<void> {
	const controller = new AbortController();
	let attempts = 0;
	const push = vi.fn((): Promise<void> => {
		attempts += 1;
		if (attempts === MAX_PUSH_RETRIES) {
			// Abort right before the last allowed attempt fails — as if the
			// signal aborted during the backoff sleep leading up to it. The
			// abort check must win over the "out of retries" check, or this
			// gets fatally rejected instead of just stopping quietly.
			controller.abort();
		}
		return Promise.reject(new Error("still down"));
	});
	const queue = createPushQueue<number>({
		maxBufferedEvents: 100,
		onWarning: vi.fn(),
		push,
		signal: controller.signal,
		sleep: instantSleep,
	});

	queue.enqueue([1]);
	await queue.close(); // must resolve — an abort is never a fatal error

	expect(attempts).toBe(MAX_PUSH_RETRIES);
}

describe("createPushQueue", () => {
	it(
		"retries a failing batch with backoff until it succeeds, without losing or reordering it",
		retriesFailingBatchWithoutLosingOrReorderingIt
	);

	it(
		"never drops a batch to a persistent failure — it keeps retrying",
		neverDropsAPersistentlyFailingBatch
	);

	it(
		"drops the oldest *queued* batch under cap pressure, but never one already in flight",
		dropsOldestQueuedBatchButNeverAnInFlightOne
	);

	it(
		`gives up and rejects (via close() and fatal) after ${MAX_PUSH_RETRIES} attempts`,
		givesUpAfterMaxRetriesAndRejects
	);

	it(
		"grants a bounded best-effort flush grace once aborted, then stops without treating it as a fatal error",
		abortGrantsABoundedFlushGraceThenStopsWithoutRejecting
	);

	it(
		"still delivers a batch whose push recovers within the abort grace",
		abortStillDeliversABatchThatRecoversWithinTheGrace
	);

	it(
		"shares the abort grace budget across the whole remaining backlog",
		abortGraceIsSharedAcrossTheWholeRemainingBacklog
	);

	it(
		`resolves close() without a fatal rejection when aborted right before the ${MAX_PUSH_RETRIES}th attempt fails`,
		abortBeforeFinalAttemptFailsResolvesWithoutFatalRejection
	);
});
