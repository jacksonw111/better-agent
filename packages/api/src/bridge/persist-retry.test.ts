import { afterEach, expect, it, vi } from "vitest";
import {
	compensationQueueSize,
	flushCompensationQueue,
	persistEventsWithRetry,
	resetPersistRetryForTests,
} from "./persist-retry";

const INPUT = {
	rows: [{ seq: 1, event: { kind: "status", status: "restarted" } }],
	sessionId: "session-1",
};
/** Inline backoff collapsed to zero so tests run instantly (3 attempts). */
const NO_DELAYS = [0, 0];

function makeStore(failures: number) {
	const appendMany = vi.fn();
	for (let i = 0; i < failures; i += 1) {
		appendMany.mockRejectedValueOnce(new Error("db down"));
	}
	appendMany.mockResolvedValue(undefined);
	return { appendMany };
}

afterEach(() => {
	resetPersistRetryForTests();
});

it("persists on the first attempt without retrying", async () => {
	const store = makeStore(0);
	await persistEventsWithRetry(store, INPUT, NO_DELAYS);
	expect(store.appendMany).toHaveBeenCalledTimes(1);
	expect(store.appendMany).toHaveBeenCalledWith("session-1", INPUT.rows);
	expect(compensationQueueSize()).toBe(0);
});

it("retries a transient failure and succeeds without queueing", async () => {
	const store = makeStore(2);
	await persistEventsWithRetry(store, INPUT, NO_DELAYS);
	expect(store.appendMany).toHaveBeenCalledTimes(3);
	expect(compensationQueueSize()).toBe(0);
});

it("parks the batch in the compensation queue after exhausting attempts", async () => {
	const store = makeStore(3);
	await persistEventsWithRetry(store, INPUT, NO_DELAYS);
	expect(store.appendMany).toHaveBeenCalledTimes(3);
	expect(compensationQueueSize()).toBe(1);

	// The DB recovered — a flush drains the queue into the store.
	await flushCompensationQueue();
	expect(store.appendMany).toHaveBeenCalledTimes(4);
	expect(store.appendMany).toHaveBeenLastCalledWith("session-1", INPUT.rows);
	expect(compensationQueueSize()).toBe(0);
});

it("keeps a still-failing batch queued across flushes until it lands", async () => {
	const store = makeStore(4);
	await persistEventsWithRetry(store, INPUT, NO_DELAYS);
	expect(compensationQueueSize()).toBe(1);

	// Still down on the first flush — the batch must survive for the next one.
	await flushCompensationQueue();
	expect(compensationQueueSize()).toBe(1);

	await flushCompensationQueue();
	expect(compensationQueueSize()).toBe(0);
});

it("never throws, even when everything fails", async () => {
	const appendMany = vi.fn().mockRejectedValue(new Error("db down"));
	await expect(
		persistEventsWithRetry({ appendMany }, INPUT, NO_DELAYS)
	).resolves.toBeUndefined();
});

it("skips empty batches entirely", async () => {
	const store = makeStore(0);
	await persistEventsWithRetry(store, { rows: [], sessionId: "s" }, NO_DELAYS);
	expect(store.appendMany).not.toHaveBeenCalled();
});
