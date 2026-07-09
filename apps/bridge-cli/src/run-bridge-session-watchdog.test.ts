import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./adapters/async-queue";
import type { RelayTransport } from "./relay-client";
import { runBridgeSession } from "./relay-client";

// RC-T5 integration coverage: session-watchdog.test.ts exercises the pure
// state machine; these tests exercise it wired into a real runBridgeSession
// call — a wedged turn (server sends "send", the fake adapter never produces
// another event) must be interrupted and the session marked "restart", while
// a subprocess exit mid-turn must surface AGENT_EXITED_STATUS and end the
// loop without hanging. Uses fake timers throughout (poll-loop.ts's default
// sleep and session-watchdog.ts's setTimeout are both bare globals, so
// `vi.advanceTimersByTimeAsync` drives both without any injected Sleep).

const WATCHDOG_STALL_MS = 5000;

function fakeTransport(
	pollCommands: RelayTransport["pollCommands"]
): RelayTransport {
	return {
		fetchConfig: vi.fn().mockResolvedValue({ config: null }),
		pollCommands,
		pushEvents: vi.fn().mockResolvedValue(undefined),
		startSession: vi
			.fn()
			.mockResolvedValue({ config: null, sessionId: "sess_1" }),
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// Split across several `describe` blocks purely to keep each under the
// repo's max-lines-per-function gate (ESLint counts a `describe` callback's
// own body, including every nested `it`, toward that limit).

describe("runBridgeSession + the RC-T5 activity watchdog - a wedged turn", () => {
	it("interrupts and retires a session whose active turn goes silent past the stall threshold", async () => {
		const events = createAsyncQueue<unknown>();
		const interrupt = vi.fn();
		const stop = vi.fn(() => events.close());
		const send = vi.fn(); // a truly wedged adapter: send() never produces another event
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ data: { text: "go", type: "text" }, id: 1 }])
			.mockResolvedValue([]);
		const transport = fakeTransport(pollCommands);
		const controller = new AbortController();

		const resultPromise = runBridgeSession({
			handle: { answerApproval: vi.fn(), events, interrupt, send, stop },
			sessionId: "sess_1",
			signal: controller.signal,
			transport,
			watchdogStallMs: WATCHDOG_STALL_MS,
		});

		// Let the poll loop pick up the "text" command (dispatches sink.send,
		// which arms the watchdog), then let the full stall threshold elapse
		// with the agent producing nothing further.
		await vi.advanceTimersByTimeAsync(WATCHDOG_STALL_MS + 1000);

		const result = await resultPromise;

		expect(result).toEqual({ outcome: "restart", sessionId: "sess_1" });
		expect(send).toHaveBeenCalledWith("go");
		expect(interrupt).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(2); // once from onStall, once from runBridgeSession's own finally
		expect(transport.pushEvents).toHaveBeenCalledWith({
			events: [{ kind: "status", status: "stalled" }],
			sessionId: "sess_1",
		});
	});
});

describe("runBridgeSession + the RC-T5 activity watchdog - a healthy turn", () => {
	it("does not fire the watchdog while a turn keeps producing events", async () => {
		const events = createAsyncQueue<unknown>();
		const interrupt = vi.fn();
		const stop = vi.fn(() => events.close());
		const send = vi.fn(() => {
			// Simulate a healthy, slow-but-alive turn: one event roughly every
			// 3s, well under the 5s stall threshold, for longer than it.
			let count = 0;
			const emit = () => {
				count += 1;
				if (count > 3) {
					events.push({ kind: "status", status: "turn_usage" });
					events.close();
					return;
				}
				events.push({
					kind: "message",
					role: "assistant",
					text: `chunk ${count}`,
				});
				setTimeout(emit, 3000);
			};
			setTimeout(emit, 3000);
		});
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ data: { text: "go", type: "text" }, id: 1 }])
			.mockResolvedValue([]);
		const transport = fakeTransport(pollCommands);
		const controller = new AbortController();

		const resultPromise = runBridgeSession({
			handle: { answerApproval: vi.fn(), events, interrupt, send, stop },
			sessionId: "sess_1",
			signal: controller.signal,
			transport,
			watchdogStallMs: WATCHDOG_STALL_MS,
		});

		await vi.advanceTimersByTimeAsync(20_000);
		const result = await resultPromise;

		expect(result.outcome).toBe("ended");
		expect(interrupt).not.toHaveBeenCalled();
	});
});

describe("runBridgeSession + the RC-T5 activity watchdog - dead process", () => {
	it("surfaces agent_exited and ends the loop without hanging when the subprocess exits mid-turn", async () => {
		const events = createAsyncQueue<unknown>();
		const interrupt = vi.fn();
		const stop = vi.fn(() => events.close());
		const send = vi.fn(() => {
			// The process dies mid-turn: it pushes AGENT_EXITED_STATUS then
			// closes its own event queue, same as every real adapter's onExit.
			events.push({ kind: "status", status: "agent_exited" });
			events.close();
		});
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ data: { text: "go", type: "text" }, id: 1 }])
			.mockResolvedValue([]);
		const transport = fakeTransport(pollCommands);
		const controller = new AbortController();

		const resultPromise = runBridgeSession({
			handle: { answerApproval: vi.fn(), events, interrupt, send, stop },
			sessionId: "sess_1",
			signal: controller.signal,
			transport,
			watchdogStallMs: WATCHDOG_STALL_MS,
		});

		await vi.advanceTimersByTimeAsync(1000);
		const result = await resultPromise;

		expect(result.outcome).toBe("ended");
		expect(interrupt).not.toHaveBeenCalled(); // the watchdog never fired — the agent exited on its own
		expect(transport.pushEvents).toHaveBeenCalledWith({
			events: [{ kind: "status", status: "agent_exited" }],
			idempotencyKeys: ["1"],
			sessionId: "sess_1",
		});
	});
});

describe("runBridgeSession + the RC-T5 activity watchdog - open approval card", () => {
	it("does not fire while an approval card is open, and resumes counting once it's answered", async () => {
		const events = createAsyncQueue<unknown>();
		const interrupt = vi.fn();
		const stop = vi.fn(() => events.close());
		const send = vi.fn(() => {
			events.push({
				detail: undefined,
				kind: "approval",
				options: [{ id: "yes", label: "Yes" }],
				requestId: "req_1",
				title: "run rm -rf",
			});
		});
		// After the approval is answered the session goes idle (a real adapter
		// would push a turn-end status here), so the watchdog naturally settles
		// rather than re-arming forever.
		const answerApproval = vi.fn(() => {
			events.push({ kind: "status", status: "turn_usage" });
			events.close();
		});
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([{ data: { text: "go", type: "text" }, id: 1 }])
			// Routed through dispatchCommands -> watchdogSink.answerApproval, same
			// as a real "answer this card" click from the web UI.
			.mockResolvedValueOnce([
				{
					data: { optionId: "yes", requestId: "req_1", type: "approval" },
					id: 2,
				},
			])
			.mockResolvedValue([]);
		const transport = fakeTransport(pollCommands);
		const controller = new AbortController();

		const resultPromise = runBridgeSession({
			handle: { answerApproval, events, interrupt, send, stop },
			sessionId: "sess_1",
			signal: controller.signal,
			transport,
			watchdogStallMs: WATCHDOG_STALL_MS,
		});

		// Card stays open well past the stall threshold — must not fire.
		await vi.advanceTimersByTimeAsync(WATCHDOG_STALL_MS + 2000);
		const result = await resultPromise;

		expect(result.outcome).toBe("ended");
		expect(answerApproval).toHaveBeenCalledWith("req_1", "yes");
		expect(interrupt).not.toHaveBeenCalled();
	});
});
