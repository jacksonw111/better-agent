import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./adapters/async-queue";
import { forwardEvents, type Sleep } from "./relay-client";

// runBridgeSession's tests live in run-bridge-session.test.ts — split out
// purely to keep each file under the repo's max-lines-per-file cap.

async function* arrayEvents<T>(values: T[]): AsyncGenerator<T> {
	await Promise.resolve();
	for (const value of values) {
		yield value;
	}
}

/** A `sleep` double whose promise only resolves when the test calls `resolve()`. */
function createControllableSleep() {
	const resolvers: Array<() => void> = [];
	const sleep: Sleep = (_ms) =>
		new Promise<void>((resolve) => {
			resolvers.push(resolve);
		});
	return { sleep, resolveCall: (index: number) => resolvers[index]?.() };
}

/** Extracted out of the `describe` block below (rather than inlined as an
 * `it` callback) purely to keep that block under the function-length cap —
 * the T1 assertion needs the full wrapped `{event, idempotencyKey}` shape
 * spelled out, which doesn't fit as a one-liner. */
async function flushesAsSoonAsMaxBatchSizeIsReached(): Promise<void> {
	const push = vi.fn().mockResolvedValue(undefined);
	// A sleep that never resolves: no timer-based flush should occur, only
	// size-triggered ones plus the final trailing flush after completion.
	const neverSleep: Sleep = () => new Promise(() => undefined);

	await forwardEvents(arrayEvents([1, 2, 3, 4, 5]), push, {
		maxBatchSize: 2,
		sleep: neverSleep,
	});

	// T1: each event is wrapped with a client-minted idempotencyKey, stable
	// and monotonic per forwardEvents call — see QueuedEvent.
	expect(push.mock.calls).toEqual([
		[
			[
				{ event: 1, idempotencyKey: "1" },
				{ event: 2, idempotencyKey: "2" },
			],
		],
		[
			[
				{ event: 3, idempotencyKey: "3" },
				{ event: 4, idempotencyKey: "4" },
			],
		],
		[[{ event: 5, idempotencyKey: "5" }]],
	]);
}

describe("forwardEvents", () => {
	it(
		"flushes as soon as maxBatchSize is reached, then the trailing partial batch",
		flushesAsSoonAsMaxBatchSizeIsReached
	);

	it("flushes a partial batch once the flush interval elapses", async () => {
		const push = vi.fn().mockResolvedValue(undefined);
		const queue = createAsyncQueue<string>();
		const { sleep, resolveCall } = createControllableSleep();

		const done = forwardEvents(queue, push, { maxBatchSize: 100, sleep });

		queue.push("a");
		// Give the event loop a turn so "a" lands in the buffer ahead of the
		// (still-pending) flush timer for this iteration.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(push).not.toHaveBeenCalled();

		resolveCall(1); // fires the flush timer created for the *next* iteration
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(push).toHaveBeenCalledWith([{ event: "a", idempotencyKey: "1" }]);

		queue.close();
		await done;
	});

	it("rejects once pushEvents exhausts its retry budget, even mid-stream", async () => {
		const events = createAsyncQueue<number>(); // left open on purpose
		events.push(1);
		const push = vi.fn().mockRejectedValue(new Error("expired token"));
		await expect(
			forwardEvents(events, push, {
				maxBatchSize: 1,
				sleep: () => new Promise(() => undefined),
				pushRetrySleep: () => Promise.resolve(),
			})
		).rejects.toThrow("attempts, giving up");
	});
});

it("forwards an event that only arrives after several idle flush ticks", async () => {
	// Regression: a slow source (e.g. claude's ~4s first token) lets the flush
	// timer fire repeatedly before any event arrives. The loop must keep the
	// SAME pending iterator.next() across those ticks, or the eventual event
	// resolves a next() nobody awaited and is silently dropped.
	const push = vi.fn().mockResolvedValue(undefined);
	const queue = createAsyncQueue<string>();
	const { sleep, resolveCall } = createControllableSleep();
	const done = forwardEvents(queue, push, { maxBatchSize: 100, sleep });
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	// Idle flush ticks fire before any event exists.
	resolveCall(0);
	await settle();
	resolveCall(1);
	await settle();
	expect(push).not.toHaveBeenCalled();

	// The event finally arrives — it must not have been lost to an orphaned next().
	queue.push("late");
	await settle();
	resolveCall(3); // flush the now-buffered event
	await settle();
	expect(push).toHaveBeenCalledWith([{ event: "late", idempotencyKey: "1" }]);

	queue.close();
	await done;
});
