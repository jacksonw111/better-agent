import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createBridgeMessageStore } from "./bridge-message-store";
import { createBridgeSessionStore } from "./bridge-session-store";
import { createBridgeTokenStore } from "./bridge-token-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedSession(
	email = `alice-${crypto.randomUUID()}@x.com`
): Promise<string> {
	const [user] = await db.insert(users).values({ email }).returning();
	const userId = user?.id ?? "";
	const tokenStore = createBridgeTokenStore(db);
	const token = await tokenStore.create({
		userId,
		tokenHash: hashToken(generateToken("bt_")),
	});
	const sessionStore = createBridgeSessionStore(db);
	const session = await sessionStore.create({
		userId,
		tokenId: token.id,
		agentKind: "claude-code",
	});
	return session.id;
}

it("append then list returns the persisted events in ascending seq order", async () => {
	const store = createBridgeMessageStore(db);
	const sessionId = await seedSession();

	await store.append(sessionId, 2, { type: "output", text: "second" });
	await store.append(sessionId, 1, { type: "output", text: "first" });

	const rows = await store.list(sessionId, 0, 10);
	expect(rows).toEqual([
		{ seq: 1, event: { type: "output", text: "first" } },
		{ seq: 2, event: { type: "output", text: "second" } },
	]);
});

it("list filters out events at or before afterSeq", async () => {
	const store = createBridgeMessageStore(db);
	const sessionId = await seedSession();

	await store.append(sessionId, 1, { type: "message", text: "a" });
	await store.append(sessionId, 2, { type: "message", text: "b" });
	await store.append(sessionId, 3, { type: "message", text: "c" });

	const rows = await store.list(sessionId, 1, 10);
	expect(rows.map((row) => row.seq)).toEqual([2, 3]);
});

it("list respects the limit", async () => {
	const store = createBridgeMessageStore(db);
	const sessionId = await seedSession();

	await store.append(sessionId, 1, { i: 1 });
	await store.append(sessionId, 2, { i: 2 });
	await store.append(sessionId, 3, { i: 3 });

	const rows = await store.list(sessionId, 0, 2);
	expect(rows.map((row) => row.seq)).toEqual([1, 2]);
});

it("list is scoped to the given session", async () => {
	const store = createBridgeMessageStore(db);
	const sessionA = await seedSession();
	const sessionB = await seedSession();

	await store.append(sessionA, 1, { from: "a" });
	await store.append(sessionB, 1, { from: "b" });

	const rowsA = await store.list(sessionA, 0, 10);
	expect(rowsA).toEqual([{ seq: 1, event: { from: "a" } }]);
});

it("appendMany persists a batch in one insert, listed in seq order", async () => {
	const store = createBridgeMessageStore(db);
	const sessionId = await seedSession();

	await store.appendMany(sessionId, [
		{ seq: 1, event: { i: 1 } },
		{ seq: 2, event: { i: 2 } },
		{ seq: 3, event: { i: 3 } },
	]);

	const rows = await store.list(sessionId, 0, 10);
	expect(rows).toEqual([
		{ seq: 1, event: { i: 1 } },
		{ seq: 2, event: { i: 2 } },
		{ seq: 3, event: { i: 3 } },
	]);
});

it("listTail returns the LAST limit rows in ascending seq order", async () => {
	const store = createBridgeMessageStore(db);
	const sessionId = await seedSession();

	await store.appendMany(sessionId, [
		{ seq: 1, event: { i: 1 } },
		{ seq: 2, event: { i: 2 } },
		{ seq: 3, event: { i: 3 } },
		{ seq: 4, event: { i: 4 } },
	]);

	const rows = await store.listTail(sessionId, 2);
	expect(rows).toEqual([
		{ seq: 3, event: { i: 3 } },
		{ seq: 4, event: { i: 4 } },
	]);
});

it("listTail is session-scoped and returns everything when under the limit", async () => {
	const store = createBridgeMessageStore(db);
	const sessionA = await seedSession();
	const sessionB = await seedSession();

	await store.append(sessionA, 1, { from: "a" });
	await store.append(sessionB, 1, { from: "b" });

	const rows = await store.listTail(sessionA, 10);
	expect(rows).toEqual([{ seq: 1, event: { from: "a" } }]);
});

it("appendMany is a no-op for an empty batch", async () => {
	const store = createBridgeMessageStore(db);
	const sessionId = await seedSession();

	await store.appendMany(sessionId, []);

	expect(await store.list(sessionId, 0, 10)).toEqual([]);
});
