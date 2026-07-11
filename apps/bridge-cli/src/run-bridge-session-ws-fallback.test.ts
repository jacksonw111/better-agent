import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./adapters/async-queue";
import type { RelayTransport, Sleep } from "./relay-client";
import { runBridgeSession } from "./relay-client";
import type { DuplexChannel } from "./ws-duplex";

async function* arrayEvents<T>(values: T[]): AsyncGenerator<T> {
	await Promise.resolve();
	for (const value of values) {
		yield value;
	}
}

// R0-T2: full `runBridgeSession`-level coverage for the two things
// run-bridge-session-duplex.test.ts's `runDuplexPhase` unit tests can't show
// on their own — that `openDuplex` returning `null`/rejecting falls all the
// way back to the UNMODIFIED HTTP path (poll-loop.ts's own tests, and every
// pre-existing run-bridge-session.test.ts case, already prove that path's
// behavior; these tests just prove the fallback actually reaches it), and
// that a live channel really does drive one whole session end to end.

function fakeTransport(
	overrides: Partial<RelayTransport> = {}
): RelayTransport {
	return {
		startSession: vi.fn().mockResolvedValue({ sessionId: "sess_1" }),
		pushEvents: vi.fn().mockResolvedValue(undefined),
		pollCommands: vi.fn().mockResolvedValue([]),
		fetchConfig: vi.fn().mockResolvedValue({ config: null }),
		...overrides,
	};
}

function fakeChannel(sendEvents: DuplexChannel["sendEvents"]): {
	channel: DuplexChannel;
	emitCommand(cmd: { data: unknown; id: number }): void;
} {
	let commandHandler: ((cmd: { data: unknown; id: number }) => void) | null =
		null;
	const channel: DuplexChannel = {
		close: vi.fn(),
		onCommand: (fn) => {
			commandHandler = fn;
		},
		onDown: vi.fn(),
		sendEvents,
	};
	return { channel, emitCommand: (cmd) => commandHandler?.(cmd) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runBridgeSession - openDuplex fallback", () => {
	it("falls back to the ordinary poll path when openDuplex resolves null", async () => {
		const controller = new AbortController();
		const openDuplex = vi.fn().mockResolvedValue(null);
		const pollCommands = vi.fn().mockResolvedValue([]);
		const pushEvents = vi.fn().mockResolvedValue(undefined);
		const transport = fakeTransport({ openDuplex, pollCommands, pushEvents });
		const sleep: Sleep = () => {
			controller.abort();
			return Promise.resolve();
		};

		const result = await runBridgeSession({
			sessionId: "sess_1",
			transport,
			handle: {
				answerApproval: vi.fn(),
				events: arrayEvents([]),
				send: vi.fn(),
				stop: vi.fn(),
			},
			signal: controller.signal,
			pollOptions: { sleep },
		});

		expect(openDuplex).toHaveBeenCalledExactlyOnceWith({
			afterId: 0,
			sessionId: "sess_1",
		});
		expect(result).toEqual({ outcome: "ended", sessionId: "sess_1" });
		expect(pollCommands).toHaveBeenCalled(); // the HTTP path actually ran
	});
});

describe("runBridgeSession - openDuplex fallback (rejection)", () => {
	it("also falls back to polling when openDuplex rejects outright", async () => {
		const controller = new AbortController();
		const openDuplex = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const pollCommands = vi.fn().mockResolvedValue([]);
		const transport = fakeTransport({ openDuplex, pollCommands });
		const sleep: Sleep = () => {
			controller.abort();
			return Promise.resolve();
		};

		const result = await runBridgeSession({
			sessionId: "sess_1",
			transport,
			handle: {
				answerApproval: vi.fn(),
				events: arrayEvents([]),
				send: vi.fn(),
				stop: vi.fn(),
			},
			signal: controller.signal,
			pollOptions: { sleep },
		});

		expect(result).toEqual({ outcome: "ended", sessionId: "sess_1" });
		expect(pollCommands).toHaveBeenCalled();
	});
});

describe("runBridgeSession - live WS duplex channel", () => {
	it("pushes events over the channel and ends via a control:stop command delivered over it", async () => {
		const events = createAsyncQueue<string>();
		const stop = vi.fn(() => events.close());
		const sendEvents = vi.fn().mockResolvedValue(undefined);
		const { channel, emitCommand } = fakeChannel(sendEvents);
		const openDuplex = vi.fn().mockResolvedValue(channel);
		const pushEvents = vi.fn().mockResolvedValue(undefined);
		const pollCommands = vi.fn().mockResolvedValue([]);
		const transport = fakeTransport({
			openDuplex,
			pollCommands,
			pushEvents,
		});
		const controller = new AbortController();

		const resultPromise = runBridgeSession({
			sessionId: "sess_1",
			transport,
			handle: { answerApproval: vi.fn(), events, send: vi.fn(), stop },
			signal: controller.signal,
		});

		await settle();
		events.push("e1");
		await settle();
		await settle();

		expect(sendEvents).toHaveBeenCalledExactlyOnceWith([
			{ event: "e1", idempotencyKey: "1" },
		]);
		expect(pollCommands).not.toHaveBeenCalled(); // never falls back to HTTP polling

		emitCommand({ id: 1, data: { type: "control", action: "stop" } });

		const result = await resultPromise;
		expect(result).toEqual({ outcome: "stopped", sessionId: "sess_1" });
		expect(stop).toHaveBeenCalledTimes(2); // dispatchControlCommand's, plus the outer finally's
		expect(pushEvents).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			events: [{ kind: "status", status: "stopped_by_server" }],
		});
	});
});
