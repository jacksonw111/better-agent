import type { BridgeSessionRow } from "@better-agent/agent/ports";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetOwnedBridgeSessionCacheForTests } from "./ownership";
import { connect, SESSION, sessionRow } from "./ws-session-test-helpers";

// Split out of ws-session.test.ts (hello/replay + live-push live there) to
// keep each describe block under the max-lines-per-function cap.

beforeEach(() => {
	__resetOwnedBridgeSessionCacheForTests();
});

async function helloed() {
	const harness = connect();
	await harness.connection.handleMessage(
		JSON.stringify({ t: "hello", sessionId: SESSION, afterId: 0 })
	);
	return harness;
}

describe("createBridgeWsConnection: events frame", () => {
	it("ingests an events frame (relay store + persistence) and acks it", async () => {
		const { connection, frames, relayStore, persistedRows } = await helloed();

		await connection.handleMessage(
			JSON.stringify({
				t: "events",
				batchId: "b1",
				events: [{ text: "hi" }],
				idempotencyKeys: ["k1"],
			})
		);

		expect(frames.at(-1)).toEqual({ t: "events_ack", batchId: "b1" });
		const stored = await relayStore.read(SESSION, "events", 0);
		expect(stored.map((e) => e.data)).toEqual([{ text: "hi" }]);
		expect(persistedRows.map((r) => r.event)).toEqual([{ text: "hi" }]);
	});

	// Rejected by the frame schema (matches the HTTP endpoint's
	// `.max(MAX_PUSH_BATCH)`), before ever reaching `ingestEvents`.
	it("an events frame over the 50-event batch cap errors and closes", async () => {
		const { connection, frames, closed } = await helloed();
		const OVER_CAP = 51;

		await connection.handleMessage(
			JSON.stringify({
				t: "events",
				batchId: "b1",
				events: Array.from({ length: OVER_CAP }, (_, i) => ({ text: `e${i}` })),
				idempotencyKeys: Array.from({ length: OVER_CAP }, (_, i) => `k${i}`),
			})
		);

		expect(frames.at(-1)).toEqual({ t: "error", message: "malformed frame" });
		expect(closed()).toBe(true);
	});

	it("an events frame with mismatched idempotencyKeys length errors and closes", async () => {
		const { connection, frames, closed } = await helloed();

		await connection.handleMessage(
			JSON.stringify({
				t: "events",
				batchId: "b1",
				events: [{ text: "hi" }, { text: "there" }],
				idempotencyKeys: ["k1"],
			})
		);

		expect(frames.at(-1)).toMatchObject({ t: "error" });
		expect(closed()).toBe(true);
	});
});

describe("createBridgeWsConnection: protocol violations", () => {
	it("a non-hello first frame errors and closes", async () => {
		const { connection, frames, closed } = connect();

		await connection.handleMessage(
			JSON.stringify({
				t: "events",
				batchId: "b1",
				events: [],
				idempotencyKeys: [],
			})
		);

		expect(frames).toEqual([{ t: "error", message: expect.any(String) }]);
		expect(closed()).toBe(true);
	});

	it("a malformed (non-JSON) frame errors and closes", async () => {
		const { connection, frames, closed } = connect();

		await connection.handleMessage("not json");

		expect(frames).toEqual([{ t: "error", message: expect.any(String) }]);
		expect(closed()).toBe(true);
	});

	it("hello for a session owned by another user errors and closes", async () => {
		const sessionsById = new Map<string, BridgeSessionRow>();
		sessionsById.set(SESSION, sessionRow({ userId: "someone-else" }));
		const { connection, frames, closed } = connect(sessionsById);

		await connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: SESSION, afterId: 0 })
		);

		expect(frames).toEqual([{ t: "error", message: expect.any(String) }]);
		expect(closed()).toBe(true);
	});

	it("hello for a nonexistent session errors and closes", async () => {
		const { connection, frames, closed } = connect();

		await connection.handleMessage(
			JSON.stringify({ t: "hello", sessionId: "unknown-session", afterId: 0 })
		);

		expect(frames).toEqual([{ t: "error", message: expect.any(String) }]);
		expect(closed()).toBe(true);
	});
});
