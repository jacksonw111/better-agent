import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./adapters/async-queue";
import type { AgentHandle } from "./adapters/types";
import type { BridgeCliArgs } from "./args";
import type { NormalizedEvent } from "./normalize/types";
import type { RelayTransport } from "./relay-client";
import { runRestartLoop } from "./restart-loop";

// A1 wiring (event-loss audit): the whole out-of-band chain — restart-loop
// builds (or accepts) ONE reliable sender, threads it through
// runBridgeSession into the poll loop's control-outcome handling, and closes
// it (final best-effort flush) once the session ends. Split out of
// restart-loop.test.ts purely for the max-lines-per-file gate.

function fakeArgs(): BridgeCliArgs {
	return {
		agentKind: "claude-code",
		cua: false,
		cuaImage: undefined,
		cuaVm: undefined,
		cuaVncUrl: undefined,
		debug: false,
		dir: "/tmp",
		label: undefined,
		opencodeTransport: "acp",
		resume: undefined,
		serverUrl: "https://example.test",
		token: "tok",
	};
}

function queueHandle(): AgentHandle {
	const events = createAsyncQueue<NormalizedEvent>();
	return {
		answerApproval: vi.fn(),
		events,
		send: vi.fn(),
		stop: vi.fn(() => events.close()),
	};
}

async function routesOobEventsThroughTheInjectedSenderAndClosesIt(): Promise<void> {
	const writeSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation(() => true);

	const transport: RelayTransport = {
		fetchConfig: vi.fn().mockResolvedValue({ config: null }),
		pollCommands: vi
			.fn()
			.mockResolvedValueOnce([
				{ id: 1, data: { type: "control", action: "stop" } },
			]),
		pushEvents: vi.fn().mockResolvedValue(undefined),
		startSession: vi.fn(),
	};
	const oobSender = { close: vi.fn(() => Promise.resolve()), push: vi.fn() };

	await runRestartLoop({
		adapter: { start: vi.fn() },
		args: fakeArgs(),
		handle: queueHandle(),
		oobSender,
		sessionId: "sess_1",
		transport,
	});

	// The session-end status rode the reliable sender (not a bare
	// fire-and-forget pushEvents), and the sender got its final flush.
	expect(oobSender.push).toHaveBeenCalledExactlyOnceWith("outcome", {
		kind: "status",
		status: "stopped_by_server",
	});
	expect(transport.pushEvents).not.toHaveBeenCalled();
	expect(oobSender.close).toHaveBeenCalledTimes(1);

	writeSpy.mockRestore();
}

describe("runRestartLoop out-of-band reliability (A1)", () => {
	it(
		"routes out-of-band events through the injected sender and closes it when the session ends",
		routesOobEventsThroughTheInjectedSenderAndClosesIt
	);
});
