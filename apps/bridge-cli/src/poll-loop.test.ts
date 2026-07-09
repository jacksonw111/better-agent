import { describe, expect, it, vi } from "vitest";
import type { CommandSink } from "./commands";
import { pollLoop, type RelayTransport, type Sleep } from "./relay-client";

/** A `CommandSink` double with both methods spied on. */
function fakeCommandSink(): CommandSink {
	return { answerApproval: vi.fn(), send: vi.fn() };
}

function fakeTransport(
	pollCommands: RelayTransport["pollCommands"]
): RelayTransport {
	return {
		startSession: vi.fn().mockResolvedValue({ sessionId: "sess_1" }),
		pushEvents: vi.fn().mockResolvedValue(undefined),
		pollCommands,
		fetchConfig: vi.fn().mockResolvedValue({ config: null }),
	};
}

const ABORT_AFTER_SLEEPS = 3;

/** A `sleep` double that records each requested interval and aborts `controller` on the Nth call. */
function createAbortingSleep(
	controller: AbortController,
	sleepCalls: number[]
): Sleep {
	return (ms) => {
		sleepCalls.push(ms);
		if (sleepCalls.length >= ABORT_AFTER_SLEEPS) {
			controller.abort();
		}
		return Promise.resolve();
	};
}

describe("pollLoop - happy path", () => {
	it("dispatches commands, advances afterId, and adapts the interval", async () => {
		const controller = new AbortController();
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ id: 1, data: "do the thing" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);
		const transport = fakeTransport(pollCommands);
		const sink = fakeCommandSink();
		const sleepCalls: number[] = [];
		const afterIdRef = { current: 0 };

		await pollLoop(transport, "sess_1", sink, afterIdRef, {
			signal: controller.signal,
			sleep: createAbortingSleep(controller, sleepCalls),
		});

		expect(pollCommands).toHaveBeenCalledTimes(3);
		expect(pollCommands).toHaveBeenNthCalledWith(1, {
			sessionId: "sess_1",
			afterId: 0,
		});
		expect(pollCommands).toHaveBeenNthCalledWith(2, {
			sessionId: "sess_1",
			afterId: 1,
		});
		expect(sink.send).toHaveBeenCalledExactlyOnceWith("do the thing");
		expect(sink.answerApproval).not.toHaveBeenCalled();
		expect(afterIdRef.current).toBe(1);
		// active poll -> fast; then backs off while idle.
		expect(sleepCalls).toEqual([500, 1000, 2000]);
	});
});

describe("pollLoop - approval commands", () => {
	it("routes an approval command to answerApproval, not send", async () => {
		const controller = new AbortController();
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([
				{
					id: 1,
					data: { type: "approval", requestId: "req_1", optionId: "allow" },
				},
			])
			.mockResolvedValue([]);
		const transport = fakeTransport(pollCommands);
		const sink = fakeCommandSink();
		const sleepCalls: number[] = [];
		const afterIdRef = { current: 0 };

		await pollLoop(transport, "sess_1", sink, afterIdRef, {
			signal: controller.signal,
			sleep: createAbortingSleep(controller, sleepCalls),
		});

		expect(sink.answerApproval).toHaveBeenCalledExactlyOnceWith(
			"req_1",
			"allow"
		);
		expect(sink.send).not.toHaveBeenCalled();
		expect(afterIdRef.current).toBe(1);
	});
});

describe("pollLoop - control stop", () => {
	it("stops the agent, pushes a final status event, and returns 'stopped' without polling again", async () => {
		const controller = new AbortController(); // never aborted: proves pollLoop returns on its own
		const pollCommands = vi
			.fn()
			.mockResolvedValue([
				{ id: 9, data: { type: "control", action: "stop" } },
			]);
		const transport = fakeTransport(pollCommands);
		const stop = vi.fn();
		const sink: CommandSink = { ...fakeCommandSink(), stop };
		const afterIdRef = { current: 0 };
		const neverSleep: Sleep = () =>
			Promise.reject(new Error("should not sleep after a stop command"));

		const outcome = await pollLoop(transport, "sess_1", sink, afterIdRef, {
			signal: controller.signal,
			sleep: neverSleep,
		});

		expect(outcome).toBe("stopped");
		expect(stop).toHaveBeenCalledTimes(1);
		expect(pollCommands).toHaveBeenCalledTimes(1);
		expect(transport.pushEvents).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			events: [{ kind: "status", status: "stopped_by_server" }],
		});
		expect(afterIdRef.current).toBe(9);
	});
});

describe("pollLoop - control restart", () => {
	it("pushes a restarting status, stops the current process, and returns 'restart' without polling again", async () => {
		const controller = new AbortController(); // never aborted: proves pollLoop returns on its own
		const pollCommands = vi
			.fn()
			.mockResolvedValue([
				{ id: 4, data: { type: "control", action: "restart" } },
			]);
		const transport = fakeTransport(pollCommands);
		const stop = vi.fn();
		const sink: CommandSink = { ...fakeCommandSink(), stop };
		const afterIdRef = { current: 0 };
		const neverSleep: Sleep = () =>
			Promise.reject(new Error("should not sleep after a restart command"));

		const outcome = await pollLoop(transport, "sess_1", sink, afterIdRef, {
			signal: controller.signal,
			sleep: neverSleep,
		});

		expect(outcome).toBe("restart");
		// `dispatchCommands` itself routes "restart" to no `CommandSink` method
		// (see commands.ts) — `pollOnce` calls `sink.stop()` directly instead, so
		// the CURRENT process actually exits (letting `runBridgeSession`'s
		// `forwardEvents` half of its `Promise.all` complete) without the
		// server-issued restart ever being mistaken for a `control: stop`
		// upstream (that distinction lives entirely in the returned outcome).
		expect(stop).toHaveBeenCalledTimes(1);
		expect(pollCommands).toHaveBeenCalledTimes(1);
		expect(transport.pushEvents).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			events: [{ kind: "status", status: "restarting" }],
		});
		expect(afterIdRef.current).toBe(4);
	});
});

describe("pollLoop - ended (no control command)", () => {
	it("returns 'ended' when the signal aborts without a stop/restart control command", async () => {
		const controller = new AbortController();
		const pollCommands = vi.fn().mockResolvedValue([]);
		const transport = fakeTransport(pollCommands);
		const afterIdRef = { current: 0 };
		const sleep: Sleep = () => {
			controller.abort();
			return Promise.resolve();
		};

		const outcome = await pollLoop(
			transport,
			"sess_1",
			fakeCommandSink(),
			afterIdRef,
			{ signal: controller.signal, sleep }
		);

		expect(outcome).toBe("ended");
	});
});

describe("pollLoop - reconnect", () => {
	it("resumes afterId across a transient transport failure", async () => {
		const controller = new AbortController();
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ id: 5, data: "a" }])
			.mockRejectedValueOnce(new Error("network blip"))
			.mockResolvedValueOnce([]);
		const transport = fakeTransport(pollCommands);
		const onError = vi.fn();
		const sleepCalls: number[] = [];
		const afterIdRef = { current: 0 };

		await pollLoop(transport, "sess_1", fakeCommandSink(), afterIdRef, {
			signal: controller.signal,
			sleep: createAbortingSleep(controller, sleepCalls),
			onError,
		});

		expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
		// The failed poll never advanced afterId, so the retry (and the poll
		// after it) both resume from the id the last *successful* poll saw.
		expect(pollCommands).toHaveBeenNthCalledWith(2, {
			sessionId: "sess_1",
			afterId: 5,
		});
		expect(pollCommands).toHaveBeenNthCalledWith(3, {
			sessionId: "sess_1",
			afterId: 5,
		});
		expect(afterIdRef.current).toBe(5);
	});
});
