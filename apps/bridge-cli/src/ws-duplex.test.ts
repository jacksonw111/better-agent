import { describe, expect, it } from "vitest";
import { connectDuplexChannel, type OpenDuplexConfig } from "./ws-duplex";
import { createFakeWsFactory, type FakeSocket } from "./ws-duplex-test-helpers";

/** Settles one macrotask — enough to drain the microtasks a resolved `sleep`
 * (and any synchronous work chained after it, up to the next await point)
 * produces, mirroring poll-loop.test.ts's own `settle` helper. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

const IMMEDIATE_SLEEP = () => Promise.resolve();

function baseConfig(
	wsFactory: OpenDuplexConfig["wsFactory"],
	afterId = 0
): OpenDuplexConfig {
	return {
		afterId,
		headers: { authorization: "Bearer tok" },
		sessionId: "sess_1",
		sleep: IMMEDIATE_SLEEP,
		url: "wss://relay.example/bridge/ws",
		wsFactory,
	};
}

/** Drives one fake socket through a successful `hello`/`hello_ok` handshake. */
function completeHandshake(socket: FakeSocket): void {
	socket.emitOpen();
	socket.emitMessage({ t: "hello_ok" });
}

describe("connectDuplexChannel - handshake", () => {
	it("sends hello on open and resolves once hello_ok arrives", async () => {
		const { factory, sockets } = createFakeWsFactory();
		const promise = connectDuplexChannel(baseConfig(factory, 7));

		expect(sockets).toHaveLength(1);
		completeHandshake(sockets[0] as FakeSocket);

		const channel = await promise;
		expect(channel).not.toBeNull();
		expect(sockets[0]?.sent).toEqual([
			{ t: "hello", sessionId: "sess_1", afterId: 7 },
		]);
	});

	it("resolves null (never throws) when the socket closes before hello_ok", async () => {
		const { factory, sockets } = createFakeWsFactory();
		const promise = connectDuplexChannel(baseConfig(factory));

		sockets[0]?.emitOpen();
		sockets[0]?.emitClose(1006, "upgrade failed");

		await expect(promise).resolves.toBeNull();
	});

	it("resolves null when the socket errors before hello_ok", async () => {
		const { factory, sockets } = createFakeWsFactory();
		const promise = connectDuplexChannel(baseConfig(factory));

		sockets[0]?.emitError(new Error("ECONNREFUSED"));

		await expect(promise).resolves.toBeNull();
	});
});

describe("connectDuplexChannel - events ack", () => {
	it("resolves sendEvents only once its matching events_ack arrives, out of order", async () => {
		const { factory, sockets } = createFakeWsFactory();
		const promise = connectDuplexChannel(baseConfig(factory));
		completeHandshake(sockets[0] as FakeSocket);
		const channel = await promise;
		const socket = sockets[0] as FakeSocket;

		const first = channel?.sendEvents([{ event: "a", idempotencyKey: "k1" }]);
		const second = channel?.sendEvents([{ event: "b", idempotencyKey: "k2" }]);

		expect(socket.sent.slice(1)).toEqual([
			{ t: "events", batchId: "b0", events: ["a"], idempotencyKeys: ["k1"] },
			{ t: "events", batchId: "b1", events: ["b"], idempotencyKeys: ["k2"] },
		]);

		let firstResolved = false;
		let secondResolved = false;
		first?.then(() => {
			firstResolved = true;
		});
		second?.then(() => {
			secondResolved = true;
		});

		// Ack the SECOND batch first — its promise must resolve independently of
		// the still-outstanding first one.
		socket.emitMessage({ t: "events_ack", batchId: "b1" });
		await settle();
		expect(secondResolved).toBe(true);
		expect(firstResolved).toBe(false);

		socket.emitMessage({ t: "events_ack", batchId: "b0" });
		await settle();
		expect(firstResolved).toBe(true);
	});
});

describe("connectDuplexChannel - command delivery", () => {
	it("delivers command frames to onCommand in order", async () => {
		const { factory, sockets } = createFakeWsFactory();
		const promise = connectDuplexChannel(baseConfig(factory));
		completeHandshake(sockets[0] as FakeSocket);
		const channel = await promise;
		const received: Array<{ data: unknown; id: number }> = [];
		channel?.onCommand((cmd) => received.push(cmd));

		sockets[0]?.emitMessage({ t: "command", id: 1, data: "first" });
		sockets[0]?.emitMessage({ t: "command", id: 2, data: "second" });

		expect(received).toEqual([
			{ id: 1, data: "first" },
			{ id: 2, data: "second" },
		]);
	});
});

describe("connectDuplexChannel - reconnect", () => {
	it("re-hellos with the advanced afterId and resends an unacked batch with the same batchId/keys", async () => {
		const { factory, sockets } = createFakeWsFactory();
		const promise = connectDuplexChannel(baseConfig(factory));
		completeHandshake(sockets[0] as FakeSocket);
		const channel = await promise;
		channel?.onCommand(() => undefined);

		// A command arrives, advancing the afterId a reconnect must resume from.
		sockets[0]?.emitMessage({ t: "command", id: 5, data: "x" });
		const pending = channel?.sendEvents([
			{ event: "unacked", idempotencyKey: "k1" },
		]);

		sockets[0]?.emitClose(1006, "socket reset");
		await settle();
		await settle();

		expect(sockets).toHaveLength(2);
		const reconnected = sockets[1] as FakeSocket;
		reconnected.emitOpen();
		expect(reconnected.sent[0]).toEqual({
			t: "hello",
			sessionId: "sess_1",
			afterId: 5,
		});

		reconnected.emitMessage({ t: "hello_ok" });
		await settle();

		// The exact same batchId/idempotencyKeys as the original attempt — the
		// server dedups a resend on those keys.
		expect(reconnected.sent[1]).toEqual({
			t: "events",
			batchId: "b0",
			events: ["unacked"],
			idempotencyKeys: ["k1"],
		});

		reconnected.emitMessage({ t: "events_ack", batchId: "b0" });
		await expect(pending).resolves.toBeUndefined();
	});
});

describe("connectDuplexChannel - reconnect give-up", () => {
	it("fires onDown exactly once after 3 consecutive failed reconnect attempts", async () => {
		const { factory, sockets } = createFakeWsFactory();
		const promise = connectDuplexChannel(baseConfig(factory));
		completeHandshake(sockets[0] as FakeSocket);
		const channel = await promise;
		const downReasons: string[] = [];
		channel?.onDown((reason) => downReasons.push(reason));

		sockets[0]?.emitClose(1006, "first drop");

		// Fail every subsequent reconnect attempt as soon as its socket exists.
		for (let attempt = 0; attempt < 3; attempt++) {
			await settle();
			await settle();
			const attemptSocket = sockets.at(-1) as FakeSocket;
			attemptSocket.emitClose(1006, "attempt failed");
		}
		await settle();
		await settle();

		expect(downReasons).toEqual(["reconnect failed after 3 attempts"]);
		// Exactly 1 (initial) + 3 (failed reconnect attempts) sockets total.
		expect(sockets).toHaveLength(4);
	});
});
