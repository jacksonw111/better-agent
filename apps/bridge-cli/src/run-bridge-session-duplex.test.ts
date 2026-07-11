import { describe, expect, it, vi } from "vitest";
import type { CommandSink } from "./commands";
import type { RelayTransport } from "./relay-client";
import {
	type RunDuplexPhaseArgs,
	runDuplexPhase,
} from "./run-bridge-session-duplex";
import type { DuplexChannel } from "./ws-duplex";

/** A `CommandSink` double with every method spied on. */
function fakeSink(): CommandSink {
	return { answerApproval: vi.fn(), send: vi.fn(), stop: vi.fn() };
}

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

/** An in-memory `DuplexChannel` double: `emitCommand`/`emitDown` drive the
 * (single) handlers `runDuplexPhase` registers, mirroring
 * ws-duplex-test-helpers.ts's `FakeSocket` but at the `DuplexChannel`
 * abstraction `run-bridge-session-duplex.ts` actually consumes — no real
 * socket/frame layer needed to exercise this module's own logic. */
function fakeChannel(sendEvents: DuplexChannel["sendEvents"]): {
	channel: DuplexChannel;
	emitCommand(cmd: { data: unknown; id: number }): void;
	emitDown(reason: string): void;
} {
	let commandHandler: ((cmd: { data: unknown; id: number }) => void) | null =
		null;
	let downHandler: ((reason: string) => void) | null = null;
	const channel: DuplexChannel = {
		close: vi.fn(),
		onCommand: (fn) => {
			commandHandler = fn;
		},
		onDown: (fn) => {
			downHandler = fn;
		},
		sendEvents,
	};
	return {
		channel,
		emitCommand: (cmd) => commandHandler?.(cmd),
		emitDown: (reason) => downHandler?.(reason),
	};
}

function baseArgs(
	overrides: Partial<RunDuplexPhaseArgs> & { channel: DuplexChannel }
): RunDuplexPhaseArgs {
	return {
		afterIdRef: { current: 0 },
		pollController: new AbortController(),
		sessionId: "sess_1",
		sink: fakeSink(),
		transport: fakeTransport(),
		...overrides,
	};
}

describe("runDuplexPhase - push", () => {
	it("sends through channel.sendEvents while the channel is live", async () => {
		const sendEvents = vi.fn().mockResolvedValue(undefined);
		const { channel } = fakeChannel(sendEvents);
		const pushEvents = vi.fn().mockResolvedValue(undefined);
		const phase = runDuplexPhase(
			baseArgs({ channel, transport: fakeTransport({ pushEvents }) })
		);
		const batch = [{ event: "a", idempotencyKey: "k1" }];

		await phase.push(batch);

		expect(sendEvents).toHaveBeenCalledWith(batch);
		expect(pushEvents).not.toHaveBeenCalled();
	});

	it("falls through to HTTP pushEvents once channel.sendEvents rejects, and stays on HTTP after that", async () => {
		const sendEvents = vi
			.fn()
			.mockRejectedValue(new Error("bridge: ws channel is down"));
		const { channel } = fakeChannel(sendEvents);
		const pushEvents = vi.fn().mockResolvedValue(undefined);
		const phase = runDuplexPhase(
			baseArgs({ channel, transport: fakeTransport({ pushEvents }) })
		);

		await phase.push([{ event: "a", idempotencyKey: "k1" }]);
		expect(pushEvents).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			events: ["a"],
			idempotencyKeys: ["k1"],
		});

		await phase.push([{ event: "b", idempotencyKey: "k2" }]);
		expect(sendEvents).toHaveBeenCalledTimes(1); // never retried on the dead channel
		expect(pushEvents).toHaveBeenCalledTimes(2);
	});
});

describe("runDuplexPhase - commands (parity with poll-loop.ts)", () => {
	it("a control:stop command delivered over the channel resolves 'stopped', same as pollLoop", async () => {
		const { channel, emitCommand } = fakeChannel(vi.fn());
		const pushEvents = vi.fn().mockResolvedValue(undefined);
		const stop = vi.fn();
		const afterIdRef = { current: 0 };
		const phase = runDuplexPhase(
			baseArgs({
				afterIdRef,
				channel,
				sink: { ...fakeSink(), stop },
				transport: fakeTransport({ pushEvents }),
			})
		);

		emitCommand({ id: 7, data: { type: "control", action: "stop" } });

		await expect(phase.outcome).resolves.toBe("stopped");
		expect(stop).toHaveBeenCalledTimes(1);
		expect(pushEvents).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			events: [{ kind: "status", status: "stopped_by_server" }],
		});
		expect(afterIdRef.current).toBe(7);
	});

	it("a control:restart command delivered over the channel resolves 'restart', same as pollLoop", async () => {
		const { channel, emitCommand } = fakeChannel(vi.fn());
		const pushEvents = vi.fn().mockResolvedValue(undefined);
		const stop = vi.fn();
		const phase = runDuplexPhase(
			baseArgs({
				channel,
				sink: { ...fakeSink(), stop },
				transport: fakeTransport({ pushEvents }),
			})
		);

		emitCommand({ id: 4, data: { type: "control", action: "restart" } });

		await expect(phase.outcome).resolves.toBe("restart");
		expect(stop).toHaveBeenCalledTimes(1);
		expect(pushEvents).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			events: [{ kind: "status", status: "restarting" }],
		});
	});

	it("resolves 'ended' as soon as pollController.signal aborts, with no control command", async () => {
		const { channel } = fakeChannel(vi.fn());
		const pollController = new AbortController();
		const phase = runDuplexPhase(baseArgs({ channel, pollController }));

		pollController.abort();

		await expect(phase.outcome).resolves.toBe("ended");
	});
});

describe("runDuplexPhase - onDown fallback", () => {
	it("falls back to pollLoop and still resolves a control command's outcome", async () => {
		const { channel, emitDown } = fakeChannel(vi.fn());
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([
				{ id: 3, data: { type: "control", action: "stop" } },
			]);
		const stop = vi.fn();
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		const phase = runDuplexPhase(
			baseArgs({
				channel,
				pollOptions: {
					sleep: () => Promise.reject(new Error("should not sleep")),
				},
				sink: { ...fakeSink(), stop },
				transport: fakeTransport({ pollCommands }),
			})
		);

		emitDown("socket reset");

		await expect(phase.outcome).resolves.toBe("stopped");
		expect(pollCommands).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			afterId: 0,
		});
		expect(stop).toHaveBeenCalledTimes(1);
		stderrSpy.mockRestore();
	});
});

describe("runDuplexPhase - onDown fallback (events)", () => {
	it("routes events over HTTP after onDown even without a channel.sendEvents rejection first", async () => {
		const sendEvents = vi.fn().mockResolvedValue(undefined);
		const { channel, emitDown } = fakeChannel(sendEvents);
		const pushEvents = vi.fn().mockResolvedValue(undefined);
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		const phase = runDuplexPhase(
			baseArgs({
				channel,
				pollOptions: { sleep: () => new Promise(() => undefined) },
				transport: fakeTransport({ pushEvents }),
			})
		);

		emitDown("socket reset");
		await phase.push([{ event: "late", idempotencyKey: "k1" }]);

		expect(sendEvents).not.toHaveBeenCalled();
		expect(pushEvents).toHaveBeenCalledExactlyOnceWith({
			sessionId: "sess_1",
			events: ["late"],
			idempotencyKeys: ["k1"],
		});
		stderrSpy.mockRestore();
	});
});
