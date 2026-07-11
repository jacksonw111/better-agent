import { beforeEach, describe, expect, it } from "vitest";
import { __resetOwnedBridgeSessionCacheForTests } from "./ownership";
import {
	connect,
	createHeldReadRelayStore,
	SESSION,
	waitUntil,
} from "./ws-session-test-helpers";

// Events-frame ingestion and protocol-violation tests live in
// ws-session-protocol.test.ts, split out to keep each describe block under
// the max-lines-per-function cap. Shared harness: ws-session-test-helpers.ts.

beforeEach(() => {
	__resetOwnedBridgeSessionCacheForTests();
});

describe("createBridgeWsConnection: hello + replay", () => {
	it("hello replies hello_ok and replays commands appended before hello", async () => {
		const { relayStore, connection, frames } = connect();
		await relayStore.append(SESSION, "commands", { a: 1 });
		await relayStore.append(SESSION, "commands", { a: 2 });

		await connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: SESSION, afterId: 0 })
		);

		expect(frames[0]).toEqual({ t: "hello_ok" });
		expect(frames.slice(1)).toEqual([
			{ t: "command", id: 1, data: { a: 1 } },
			{ t: "command", id: 2, data: { a: 2 } },
		]);
	});

	it("hello with afterId skips already-seen commands on replay", async () => {
		const { relayStore, connection, frames } = connect();
		const first = await relayStore.append(SESSION, "commands", { a: 1 });
		await relayStore.append(SESSION, "commands", { a: 2 });

		await connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: SESSION, afterId: first.id })
		);

		expect(frames).toEqual([
			{ t: "hello_ok" },
			{ t: "command", id: 2, data: { a: 2 } },
		]);
	});

	it("touches the session on hello", async () => {
		const { connection, touched } = connect();

		await connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: SESSION, afterId: 0 })
		);

		expect(touched).toEqual([SESSION]);
	});
});

describe("createBridgeWsConnection: live command push via CommandBus", () => {
	it("a command appended after hello is pushed once the bus is notified", async () => {
		const { relayStore, commandBus, connection, frames } = connect();
		await connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: SESSION, afterId: 0 })
		);
		expect(frames).toEqual([{ t: "hello_ok" }]);

		await relayStore.append(SESSION, "commands", { live: true });
		commandBus.notify(SESSION);
		// notify() kicks off an async pump; let its microtasks settle.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(frames).toEqual([
			{ t: "hello_ok" },
			{ t: "command", id: 1, data: { live: true } },
		]);
	});

	it("stops pushing commands after handleClose unsubscribes", async () => {
		const { relayStore, commandBus, connection, frames } = connect();
		await connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: SESSION, afterId: 0 })
		);
		connection.handleClose();

		await relayStore.append(SESSION, "commands", { live: true });
		commandBus.notify(SESSION);
		await Promise.resolve();
		await Promise.resolve();

		expect(frames).toEqual([{ t: "hello_ok" }]);
	});
});

describe("createBridgeWsConnection: command pump race safety", () => {
	// createHeldReadRelayStore's `read` never resolves on its own, so this
	// genuinely puts a notify() in flight WHILE a read is pending — unlike
	// the real in-memory store (same-tick `read`), which can't exercise
	// createCommandPump's running/rerun guard at all.
	it("coalesces notifies that arrive during an in-flight read into exactly one rerun", async () => {
		const { pendingReads, readCalls, relayStore, resolveOldestRead } =
			createHeldReadRelayStore();
		const { connection, commandBus, frames } = connect(undefined, relayStore);
		const helloDone = connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: SESSION, afterId: 0 })
		);
		await waitUntil(() => pendingReads.length > 0);
		await resolveOldestRead(); // initial replay: nothing appended yet
		await helloDone;
		expect(frames).toEqual([{ t: "hello_ok" }]);

		await relayStore.append(SESSION, "commands", { a: 1 });
		commandBus.notify(SESSION); // read A starts and is held open
		expect(pendingReads).toHaveLength(1);

		await relayStore.append(SESSION, "commands", { a: 2 });
		commandBus.notify(SESSION); // coalesces: marks rerun, no 2nd read
		commandBus.notify(SESSION); // coalesces again: still just rerun
		expect(pendingReads).toHaveLength(1);

		await resolveOldestRead(); // read A resolves; the coalesced rerun fires read B
		await resolveOldestRead(); // read B resolves; pump drains and stops

		expect(frames).toEqual([
			{ t: "hello_ok" },
			{ t: "command", id: 1, data: { a: 1 } },
			{ t: "command", id: 2, data: { a: 2 } },
		]);
		const READS_AFTER_INITIAL_REPLAY = 2; // read A + one coalesced rerun (read B)
		expect(readCalls()).toBe(1 + READS_AFTER_INITIAL_REPLAY);
	});
});
