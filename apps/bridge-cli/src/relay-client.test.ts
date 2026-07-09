import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./adapters/async-queue";
import {
	type AgentSessionIdRef,
	forwardEvents,
	type RelayTransport,
	runBridgeSession,
	type Sleep,
} from "./relay-client";

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

describe("forwardEvents", () => {
	it("flushes as soon as maxBatchSize is reached, then the trailing partial batch", async () => {
		const push = vi.fn().mockResolvedValue(undefined);
		// A sleep that never resolves: no timer-based flush should occur, only
		// size-triggered ones plus the final trailing flush after completion.
		const neverSleep: Sleep = () => new Promise(() => undefined);

		await forwardEvents(arrayEvents([1, 2, 3, 4, 5]), push, {
			maxBatchSize: 2,
			sleep: neverSleep,
		});

		expect(push.mock.calls).toEqual([[[1, 2]], [[3, 4]], [[5]]]);
	});

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
		expect(push).toHaveBeenCalledWith(["a"]);

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
	expect(push).toHaveBeenCalledWith(["late"]);

	queue.close();
	await done;
});

function fakeTransport(
	pollCommands: RelayTransport["pollCommands"]
): RelayTransport {
	return {
		startSession: vi
			.fn()
			.mockResolvedValue({ sessionId: "sess_1", config: null }),
		pushEvents: vi.fn().mockResolvedValue(undefined),
		pollCommands,
		fetchConfig: vi.fn().mockResolvedValue({ config: null }),
	};
}

async function startsSessionPushesEventsAndPollsUnderOneSessionId(): Promise<void> {
	const controller = new AbortController();
	const transport = fakeTransport(vi.fn().mockResolvedValue([]));
	const send = vi.fn();
	const stop = vi.fn();
	const sleep: Sleep = () => {
		controller.abort();
		return Promise.resolve();
	};

	const result = await runBridgeSession({
		sessionId: "sess_1",
		transport,
		handle: {
			answerApproval: vi.fn(),
			events: arrayEvents(["e1", "e2"]),
			send,
			stop,
		},
		signal: controller.signal,
		pollOptions: { sleep },
	});

	expect(result).toEqual({ outcome: "ended", sessionId: "sess_1" });
	expect(transport.pushEvents).toHaveBeenCalledWith({
		sessionId: "sess_1",
		events: ["e1", "e2"],
	});
	// The agent process must be released once the session winds down.
	expect(stop).toHaveBeenCalledTimes(1);
}

const FORWARD_TEST_MAX_BATCH_SIZE = 100;

async function retriesAFailedPushEventsBatchInsteadOfDroppingIt(): Promise<void> {
	const controller = new AbortController();
	const pushedBatches: number[][] = [];
	let failuresRemaining = 1;
	const pushEvents = vi.fn(
		async (input: { events: unknown[] }): Promise<void> => {
			await Promise.resolve();
			if (failuresRemaining > 0) {
				failuresRemaining -= 1;
				throw new Error("network blip");
			}
			pushedBatches.push(input.events as number[]);
		}
	);
	const transport = fakeTransport(vi.fn().mockResolvedValue([]));
	transport.pushEvents = pushEvents;
	const stop = vi.fn();
	const neverSleep: Sleep = () => new Promise(() => undefined); // trailing flush only

	await runBridgeSession({
		sessionId: "sess_1",
		transport,
		handle: {
			answerApproval: vi.fn(),
			events: arrayEvents([1, 2, 3]),
			send: vi.fn(),
			stop,
		},
		signal: controller.signal,
		forwardOptions: {
			maxBatchSize: FORWARD_TEST_MAX_BATCH_SIZE,
			sleep: neverSleep,
			pushRetrySleep: () => Promise.resolve(),
		},
		pollOptions: { sleep: () => Promise.resolve() },
	});

	expect(pushedBatches).toEqual([[1, 2, 3]]); // exact same batch, in order, once
	expect(pushEvents).toHaveBeenCalledTimes(2);
	expect(stop).toHaveBeenCalledTimes(1);
}

/** Shared by the `control:stop` and `control:restart` cases below — both tear
 * down the process (`stop` called once by the control handling, once more by
 * `runBridgeSession`'s own `finally`) and differ only in outcome/status. */
async function aControlCommandTearsDownAndReportsOutcome(
	action: "restart" | "stop",
	outcome: "restart" | "stopped",
	status: "restarting" | "stopped_by_server"
): Promise<void> {
	const controller = new AbortController(); // never aborted externally — proves the session ends on its own
	// A real adapter's stop() closes its own event queue; mimicked here.
	const events = createAsyncQueue<string>();
	const stop = vi.fn(() => events.close());
	const pollCommands = vi
		.fn()
		.mockResolvedValueOnce([{ id: 1, data: { type: "control", action } }]);
	const transport = fakeTransport(pollCommands);

	const result = await runBridgeSession({
		sessionId: "sess_1",
		transport,
		handle: { answerApproval: vi.fn(), events, send: vi.fn(), stop },
		signal: controller.signal,
		pollOptions: {
			sleep: () => Promise.reject(new Error("should not sleep")),
		},
	});

	expect(result).toEqual({ outcome, sessionId: "sess_1" });
	expect(stop).toHaveBeenCalledTimes(2);
	expect(pollCommands).toHaveBeenCalledTimes(1);
	expect(transport.pushEvents).toHaveBeenCalledExactlyOnceWith({
		sessionId: "sess_1",
		events: [{ kind: "status", status }],
	});
}

async function capturesTheLatestSessionReadyIdIntoAgentSessionIdRef(): Promise<void> {
	const controller = new AbortController();
	const transport = fakeTransport(vi.fn().mockResolvedValue([]));
	const sleep: Sleep = () => {
		controller.abort();
		return Promise.resolve();
	};
	const agentSessionIdRef: AgentSessionIdRef = {};

	await runBridgeSession({
		sessionId: "sess_1",
		transport,
		handle: {
			answerApproval: vi.fn(),
			events: arrayEvents([
				{
					kind: "status",
					status: "session_ready",
					detail: { sessionId: "conv_1" },
				},
				{ kind: "message", role: "assistant", text: "hi" },
				{
					kind: "status",
					status: "session_ready",
					detail: { sessionId: "conv_2" },
				},
			]),
			send: vi.fn(),
			stop: vi.fn(),
		},
		signal: controller.signal,
		agentSessionIdRef,
		pollOptions: { sleep },
	});

	expect(agentSessionIdRef.current).toBe("conv_2"); // the LATEST id, not the first
}

describe("runBridgeSession", () => {
	it(
		"starts a session, pushes events, and polls under one sessionId",
		startsSessionPushesEventsAndPollsUnderOneSessionId
	);

	it(
		"retries a failed pushEvents batch instead of dropping it, preserving order",
		retriesAFailedPushEventsBatchInsteadOfDroppingIt
	);

	it("a control:stop command stops the agent, pushes a status event, and ends the session", () =>
		aControlCommandTearsDownAndReportsOutcome(
			"stop",
			"stopped",
			"stopped_by_server"
		));

	it("a control:restart command stops the current process, pushes a restarting status, and returns the 'restart' outcome", () =>
		aControlCommandTearsDownAndReportsOutcome(
			"restart",
			"restart",
			"restarting"
		));

	it(
		"captures the latest session_ready event's detail.sessionId into agentSessionIdRef",
		capturesTheLatestSessionReadyIdIntoAgentSessionIdRef
	);
});
