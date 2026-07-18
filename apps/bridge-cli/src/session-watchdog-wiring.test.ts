import { describe, expect, it, vi } from "vitest";
import type { RelayTransport } from "./relay-client";
import { makeOnStall } from "./session-watchdog-wiring";

// A1: the watchdog's "stalled" marker used to be a lone fire-and-forget
// push. With an `oobPush` wired in (production always passes one via
// runBridgeSession — see restart-loop.ts), it rides the reliable channel.

function fakeTransport(): RelayTransport {
	return {
		fetchConfig: vi.fn(),
		pollCommands: vi.fn(),
		pushEvents: vi.fn(() => Promise.resolve()),
		startSession: vi.fn(),
	};
}

function stallArgs(transport: RelayTransport) {
	return {
		handle: { interrupt: vi.fn(), stop: vi.fn() },
		outcomeRef: {},
		sessionId: "sess_1",
		stopPolling: vi.fn(),
		transport,
	};
}

describe("makeOnStall stalled-status routing", () => {
	it("routes the stalled marker through oobPush when one is wired", () => {
		const transport = fakeTransport();
		const oobPush = vi.fn();
		const onStall = makeOnStall({ ...stallArgs(transport), oobPush });

		onStall();

		expect(oobPush).toHaveBeenCalledExactlyOnceWith("watchdog", {
			kind: "status",
			status: "stalled",
		});
		expect(transport.pushEvents).not.toHaveBeenCalled();
	});

	it("falls back to the legacy direct best-effort push without an oobPush", () => {
		const transport = fakeTransport();
		const onStall = makeOnStall(stallArgs(transport));

		onStall();

		expect(transport.pushEvents).toHaveBeenCalledExactlyOnceWith({
			events: [{ kind: "status", status: "stalled" }],
			sessionId: "sess_1",
		});
	});
});
