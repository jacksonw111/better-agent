import { describe, expect, it, vi } from "vitest";
import { resolveControlOutcome } from "./command-outcome";
import type { CommandSink } from "./commands";
import type { RelayTransport } from "./relay-client";

// A1: the session-end status ("stopped_by_server"/"restarting") used to be a
// single best-effort push with no retry — exactly the terminal event a
// reopened session needs. With an `oobPush` wired in (production always
// passes one, see restart-loop.ts), it rides the reliable out-of-band
// channel instead; without one (older tests/callers), the legacy direct
// best-effort push still applies.

function fakeSink(): CommandSink {
	return { answerApproval: vi.fn(), send: vi.fn(), stop: vi.fn() };
}

function fakeTransport(): RelayTransport {
	return {
		fetchConfig: vi.fn(),
		pollCommands: vi.fn(),
		pushEvents: vi.fn(() => Promise.resolve()),
		startSession: vi.fn(),
	};
}

const STOP_COMMANDS = [{ data: { action: "stop", type: "control" }, id: 1 }];

describe("resolveControlOutcome out-of-band status routing", () => {
	it("routes the stop status through oobPush when one is wired", async () => {
		const transport = fakeTransport();
		const oobPush = vi.fn();

		const outcome = await resolveControlOutcome({
			afterIdRef: { current: 0 },
			commands: STOP_COMMANDS,
			oobPush,
			sessionId: "sess_1",
			sink: fakeSink(),
			transport,
		});

		expect(outcome.control).toBe("stop");
		expect(oobPush).toHaveBeenCalledExactlyOnceWith("outcome", {
			kind: "status",
			status: "stopped_by_server",
		});
		expect(transport.pushEvents).not.toHaveBeenCalled();
	});

	it("falls back to the legacy direct best-effort push without an oobPush", async () => {
		const transport = fakeTransport();

		await resolveControlOutcome({
			afterIdRef: { current: 0 },
			commands: STOP_COMMANDS,
			sessionId: "sess_1",
			sink: fakeSink(),
			transport,
		});

		expect(transport.pushEvents).toHaveBeenCalledExactlyOnceWith({
			events: [{ kind: "status", status: "stopped_by_server" }],
			sessionId: "sess_1",
		});
	});
});
