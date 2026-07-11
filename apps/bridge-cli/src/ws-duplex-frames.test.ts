import { describe, expect, it } from "vitest";
import type { ChannelState } from "./ws-duplex";
import { handleServerMessage } from "./ws-duplex-frames";

// R0 final-review fix: handleCommandFrame used to set `state.lastCommandId =
// frame.id` unconditionally on a successful dispatch — fine when dispatches
// complete in the order their frames arrived, but a slower EARLIER dispatch
// finishing AFTER a faster LATER one would regress the cursor backwards,
// making the next reconnect handshake redeliver commands already handled.
// Fixed with `Math.max(state.lastCommandId, frame.id)`.

function fakeState(
	commandHandler: ChannelState["commandHandler"]
): ChannelState {
	return {
		closed: false,
		commandHandler,
		config: {} as ChannelState["config"],
		downFired: false,
		downHandler: null,
		lastCommandId: 0,
		nextBatchSeq: 0,
		pending: new Map(),
		reconnecting: false,
		socket: {} as ChannelState["socket"],
	};
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("handleServerMessage: command frame lastCommandId ordering", () => {
	it("does not regress lastCommandId when an earlier dispatch resolves after a later one", async () => {
		const resolvers = new Map<number, () => void>();
		const state = fakeState(
			(cmd) =>
				new Promise<void>((resolve) => {
					resolvers.set(cmd.id, resolve);
				})
		);

		handleServerMessage(
			state,
			JSON.stringify({ t: "command", id: 5, data: {} })
		);
		handleServerMessage(
			state,
			JSON.stringify({ t: "command", id: 7, data: {} })
		);

		// The LATER command (7) finishes first...
		resolvers.get(7)?.();
		await flushMicrotasks();
		expect(state.lastCommandId).toBe(7);

		// ...then the EARLIER, slower dispatch (5) finishes after it.
		resolvers.get(5)?.();
		await flushMicrotasks();

		// Must stay at the highest id seen, not regress back to 5.
		expect(state.lastCommandId).toBe(7);
	});
});
