import { afterEach, describe, expect, it, vi } from "vitest";
import { startServe } from "./opencode-serve-test-support";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("opencodeServeAdapter - getStatus", () => {
	it("fetches the session's messages and pushes one status_snapshot with the mapped tokens/cost/model", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.messages.messageBody = [
			{
				info: {
					role: "assistant",
					providerID: "anthropic",
					modelID: "claude-sonnet-4",
					cost: 0.045,
					tokens: { input: 100, output: 20, cache: { read: 5, write: 0 } },
				},
			},
		];

		handle.getStatus?.();

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "status_snapshot",
			detail: {
				model: "anthropic/claude-sonnet-4",
				costUsd: 0.045,
				tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 },
			},
			turnEpoch: 0,
		});
		const call = server.calls.find((c) =>
			c.url.endsWith("/session/ses_1/message")
		);
		expect(call?.method).toBe("GET");
	});

	it("pushes an empty-fields status_snapshot instead of throwing when the fetch fails", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready
		server.messages.messageOk = false;

		expect(() => handle.getStatus?.()).not.toThrow();

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "status_snapshot",
			detail: {},
			turnEpoch: 0,
		});
	});
});
