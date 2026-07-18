import { describe, expect, it, vi } from "vitest";
import { createPushQueue, type Sleep } from "./push-queue";

// A2 (event-loss audit): createPushQueue with a ShedPolicy — class-aware
// overflow shedding. Split out of push-queue.test.ts purely to keep that
// file under the repo's max-lines-per-file gate.

const instantSleep: Sleep = () => Promise.resolve();

/** A shed-policy fixture over plain strings: items starting with "d" are the
 * droppable "delta" class, everything else is protected. */
const stringShedPolicy = {
	isDroppable: (item: string) => item.startsWith("d"),
	makeDropMarker: (droppedCount: number) => `marker:${droppedCount}`,
};

/** Blocks the sender on its first push (so later enqueues pile up in the
 * droppable backlog) and records every pushed batch. */
function blockedFirstPushRig() {
	const firstPushStarted = Promise.withResolvers<void>();
	const releaseFirstPush = Promise.withResolvers<void>();
	const calls: string[][] = [];
	const push = vi.fn(async (batch: string[]): Promise<void> => {
		calls.push(batch);
		if (calls.length === 1) {
			firstPushStarted.resolve();
			await releaseFirstPush.promise;
		}
	});
	return { calls, firstPushStarted, push, releaseFirstPush };
}

async function shedsOnlyDroppableItemsAndPushesAMarker(): Promise<void> {
	const rig = blockedFirstPushRig();
	const onWarning = vi.fn();
	const queue = createPushQueue<string>({
		maxBufferedEvents: 3,
		onWarning,
		push: rig.push,
		shedPolicy: stringShedPolicy,
		sleep: instantSleep,
	});

	queue.enqueue(["p0"]);
	await rig.firstPushStarted.promise; // ["p0"] in flight, out of the backlog

	queue.enqueue(["d1", "p1"]); // backlog: 2
	queue.enqueue(["d2"]); // backlog: 3 (== cap, no shed yet)
	queue.enqueue(["p2", "d3"]); // backlog: 5 > cap -> sheds d1, d2 (oldest deltas)

	expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("dropped 2"));

	rig.releaseFirstPush.resolve();
	await queue.close();

	// Protected items all survived, only the oldest droppable items were shed,
	// and one marker batch was inserted where the omission happened (front of
	// the backlog) so the consumer knows something was elided.
	expect(rig.calls).toEqual([["p0"], ["marker:2"], ["p1"], ["p2", "d3"]]);
}

async function neverShedsProtectedItemsEvenOverTheCap(): Promise<void> {
	const rig = blockedFirstPushRig();
	const onWarning = vi.fn();
	const queue = createPushQueue<string>({
		maxBufferedEvents: 2,
		onWarning,
		push: rig.push,
		shedPolicy: stringShedPolicy,
		sleep: instantSleep,
	});

	queue.enqueue(["p0"]);
	await rig.firstPushStarted.promise;

	queue.enqueue(["p1"]);
	queue.enqueue(["p2"]);
	queue.enqueue(["p3"]); // over cap, but nothing is droppable

	rig.releaseFirstPush.resolve();
	await queue.close();

	// The protected classes (approvals, final messages, statuses…) are never
	// shed: the queue grows past the cap instead, and no marker is faked.
	expect(rig.calls).toEqual([["p0"], ["p1"], ["p2"], ["p3"]]);
	expect(onWarning).not.toHaveBeenCalled();
}

describe("createPushQueue shed policy", () => {
	it(
		"sheds only droppable (delta-class) items under cap pressure and pushes a drop marker",
		shedsOnlyDroppableItemsAndPushesAMarker
	);

	it(
		"never sheds protected items, even when the backlog exceeds the cap",
		neverShedsProtectedItemsEvenOverTheCap
	);
});
