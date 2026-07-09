import { expect, it } from "vitest";
import { createAsyncQueue } from "./async-queue";
import {
	bumpTurnEpoch,
	createTurnEpoch,
	turnStampingQueue,
} from "./turn-epoch";

it("starts at epoch 0 and advances by one per bump", () => {
	const epoch = createTurnEpoch();
	expect(epoch.current).toBe(0);
	expect(bumpTurnEpoch(epoch)).toBe(1);
	expect(epoch.current).toBe(1);
	expect(bumpTurnEpoch(epoch)).toBe(2);
});

it("stamps every pushed event with the epoch current at push time", async () => {
	const epoch = createTurnEpoch();
	const queue = turnStampingQueue(
		createAsyncQueue<{ kind: string; turnEpoch?: number }>(),
		epoch
	);
	const iterator = queue[Symbol.asyncIterator]();

	bumpTurnEpoch(epoch); // epoch 1: a turn starts
	queue.push({ kind: "a" });
	expect((await iterator.next()).value).toEqual({ kind: "a", turnEpoch: 1 });

	bumpTurnEpoch(epoch); // epoch 2: interrupted
	queue.push({ kind: "b" });
	expect((await iterator.next()).value).toEqual({ kind: "b", turnEpoch: 2 });
});

it("closes and iterates through the wrapped queue unchanged", async () => {
	const epoch = createTurnEpoch();
	const raw = createAsyncQueue<{ kind: string; turnEpoch?: number }>();
	const queue = turnStampingQueue(raw, epoch);
	const iterator = queue[Symbol.asyncIterator]();

	queue.push({ kind: "only" });
	queue.close();

	expect(await iterator.next()).toEqual({
		done: false,
		value: { kind: "only", turnEpoch: 0 },
	});
	expect((await iterator.next()).done).toBe(true);
});
