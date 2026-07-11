import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./adapters/async-queue";
import type { AgentSessionIdRef } from "./capture-agent-session-id";
import type { RelayTransport, Sleep } from "./relay-client";
import { runBridgeSession } from "./relay-client";

// Split out of relay-client.test.ts (which keeps forwardEvents's own tests)
// purely to keep each file under the repo's max-lines-per-file cap.

async function* arrayEvents<T>(values: T[]): AsyncGenerator<T> {
	await Promise.resolve();
	for (const value of values) {
		yield value;
	}
}

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
		// Batch-shape assertion below — opt out of the leading-edge first flush
		// (default true) so both events land in ONE batch.
		forwardOptions: { leadingEdgeFlush: false },
		pollOptions: { sleep },
	});

	expect(result).toEqual({ outcome: "ended", sessionId: "sess_1" });
	// T1: idempotencyKeys ride alongside events, index-aligned.
	expect(transport.pushEvents).toHaveBeenCalledWith({
		sessionId: "sess_1",
		events: ["e1", "e2"],
		idempotencyKeys: ["1", "2"],
	});
	// The agent process must be released once the session winds down.
	expect(stop).toHaveBeenCalledTimes(1);
}

const FORWARD_TEST_MAX_BATCH_SIZE = 100;

async function retriesAFailedPushEventsBatchInsteadOfDroppingIt(): Promise<void> {
	const controller = new AbortController();
	const pushedBatches: number[][] = [];
	// T1: every call's idempotencyKeys, so we can assert the failed attempt and
	// the successful retry sent the SAME keys — proof the key is minted once
	// (at buffer time) and reused across a push-queue retry, not regenerated.
	const seenIdempotencyKeys: (string[] | undefined)[] = [];
	let failuresRemaining = 1;
	const pushEvents = vi.fn(
		async (input: {
			events: unknown[];
			idempotencyKeys?: string[];
		}): Promise<void> => {
			await Promise.resolve();
			seenIdempotencyKeys.push(input.idempotencyKeys);
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
			// Batch-shape assertion below — opt out of the leading-edge first
			// flush (default true) so all three events land in ONE batch.
			leadingEdgeFlush: false,
			maxBatchSize: FORWARD_TEST_MAX_BATCH_SIZE,
			sleep: neverSleep,
			pushRetrySleep: () => Promise.resolve(),
		},
		pollOptions: { sleep: () => Promise.resolve() },
	});

	expect(pushedBatches).toEqual([[1, 2, 3]]); // exact same batch, in order, once
	expect(pushEvents).toHaveBeenCalledTimes(2);
	expect(seenIdempotencyKeys).toEqual([
		["1", "2", "3"],
		["1", "2", "3"],
	]); // identical on the failed attempt and the successful retry
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
	// This push comes from poll-loop.ts's pushBestEffortStatus, NOT
	// forwardEvents — it's a one-shot, non-retried, best-effort send (failure
	// is swallowed, never retried), so it carries no idempotencyKeys: T1's
	// dedup is only needed where a lost ack can cause a resend.
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
