import { describe, expect, it, vi } from "vitest";
import { type AsyncQueue, createAsyncQueue } from "./adapters/async-queue";
import type { Adapter, AgentHandle } from "./adapters/types";
import type { BridgeCliArgs } from "./args";
import type { NormalizedEvent } from "./normalize/types";
import type { RelayTransport } from "./relay-client";
import { runRestartLoop } from "./restart-loop";

function fakeArgs(overrides: Partial<BridgeCliArgs> = {}): BridgeCliArgs {
	return {
		agentKind: "claude-code",
		debug: false,
		dir: "/tmp",
		label: undefined,
		opencodeTransport: "acp",
		resume: undefined,
		serverUrl: "https://example.test",
		token: "tok",
		...overrides,
	};
}

function fakeTransport(
	pollCommands: RelayTransport["pollCommands"],
	fetchConfig: RelayTransport["fetchConfig"]
): RelayTransport {
	return {
		startSession: vi.fn(),
		pushEvents: vi.fn().mockResolvedValue(undefined),
		pollCommands,
		fetchConfig,
	};
}

/** An `AgentHandle` backed by an `AsyncQueue`, so `stop()` ends its own event
 * stream the same way a real adapter's `stop()` would — letting
 * `runBridgeSession`'s `forwardEvents` half of its `Promise.all` complete on
 * its own once the loop tears the process down. */
function queueHandle(): {
	events: AsyncQueue<NormalizedEvent>;
	handle: AgentHandle;
	stop: ReturnType<typeof vi.fn>;
} {
	const events = createAsyncQueue<NormalizedEvent>();
	const stop = vi.fn(() => events.close());
	return {
		events,
		handle: { answerApproval: vi.fn(), events, send: vi.fn(), stop },
		stop,
	};
}

/** Extracted from its `it()` block to stay under the max-lines-per-function
 * gate: on a control:restart, the loop must tear down the old process, fetch
 * fresh config, and relaunch with the captured agent sessionId under the same
 * bridge sessionId. */
async function tearsDownFetchesFreshConfigAndRelaunchesWithCapturedSessionId(): Promise<void> {
	const writeSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation(() => true);

	const { events: events1, handle: handle1, stop: stop1 } = queueHandle();
	events1.push({
		kind: "status",
		status: "session_ready",
		detail: { sessionId: "conv_abc" },
	});
	const { handle: handle2, stop: stop2 } = queueHandle();

	const pollCommands = vi
		.fn()
		.mockResolvedValueOnce([
			{ id: 1, data: { type: "control", action: "restart" } },
		])
		.mockResolvedValueOnce([
			{ id: 2, data: { type: "control", action: "stop" } },
		]);
	const fetchConfig = vi.fn().mockResolvedValue({ config: { model: "opus" } });
	const transport = fakeTransport(pollCommands, fetchConfig);

	const start = vi.fn().mockResolvedValue(handle2);
	const adapter: Adapter = { start };

	await runRestartLoop({
		adapter,
		args: fakeArgs({ resume: "fallback_resume" }),
		handle: handle1,
		sessionId: "sess_1",
		transport,
	});

	expect(fetchConfig).toHaveBeenCalledTimes(1);
	// The captured agent-side conversation id wins over the CLI's original
	// --resume — a restart should reconnect to the SAME agent conversation,
	// not whatever the process happened to be launched with originally.
	expect(start).toHaveBeenCalledExactlyOnceWith("/tmp", {
		resume: "conv_abc",
		config: { model: "opus" },
	});
	// Once from poll-loop.ts's restart handling calling sink.stop() directly,
	// once more from runBridgeSession's own unconditional cleanup finally.
	expect(stop1).toHaveBeenCalledTimes(2);
	expect(stop2).toHaveBeenCalledTimes(2);
	expect(pollCommands).toHaveBeenCalledTimes(2);
	expect(writeSpy).toHaveBeenCalledWith("Bridge session ended: sess_1\n");

	writeSpy.mockRestore();
}

describe("runRestartLoop restart", () => {
	it(
		"on a control:restart, tears down the old process, fetches fresh config, and relaunches with the captured agent sessionId under the same bridge sessionId",
		tearsDownFetchesFreshConfigAndRelaunchesWithCapturedSessionId
	);

	it("falls back to the CLI's original --resume id when no session_ready event arrived before the restart", async () => {
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		const { handle: handle1 } = queueHandle();
		const { handle: handle2 } = queueHandle();

		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([
				{ id: 1, data: { type: "control", action: "restart" } },
			])
			.mockResolvedValueOnce([
				{ id: 2, data: { type: "control", action: "stop" } },
			]);
		const fetchConfig = vi.fn().mockResolvedValue({ config: null });
		const transport = fakeTransport(pollCommands, fetchConfig);

		const start = vi.fn().mockResolvedValue(handle2);
		const adapter: Adapter = { start };

		await runRestartLoop({
			adapter,
			args: fakeArgs({ resume: "fallback_resume" }),
			handle: handle1,
			sessionId: "sess_1",
			transport,
		});

		expect(start).toHaveBeenCalledExactlyOnceWith("/tmp", {
			resume: "fallback_resume",
			config: undefined,
		});

		writeSpy.mockRestore();
	});
});

describe("runRestartLoop stop", () => {
	it("ends without relaunching when the first outcome is a plain control:stop", async () => {
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		const { handle: handle1 } = queueHandle();
		const pollCommands = vi
			.fn()
			.mockResolvedValueOnce([
				{ id: 1, data: { type: "control", action: "stop" } },
			]);
		const fetchConfig = vi.fn().mockResolvedValue({ config: null });
		const transport = fakeTransport(pollCommands, fetchConfig);
		const start = vi.fn();
		const adapter: Adapter = { start };

		await runRestartLoop({
			adapter,
			args: fakeArgs(),
			handle: handle1,
			sessionId: "sess_1",
			transport,
		});

		expect(start).not.toHaveBeenCalled();
		expect(fetchConfig).not.toHaveBeenCalled();
		expect(writeSpy).toHaveBeenCalledWith("Bridge session ended: sess_1\n");

		writeSpy.mockRestore();
	});
});
