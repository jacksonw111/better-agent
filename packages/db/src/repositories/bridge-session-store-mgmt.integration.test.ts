import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { bridgeMessages, bridgeSessions } from "../schema/bridge";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createBridgeSessionStore } from "./bridge-session-store";
import { createBridgeTokenStore } from "./bridge-token-store";

// P3-T1: rename / setArchived / setStarred / deleteHard + the archived-aware
// listPageByUser filter — split from bridge-session-store.integration.test.ts
// to keep that file under the repo's 300-line cap.

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

async function seedSession(userId: string): Promise<string> {
	const tokenStore = createBridgeTokenStore(db);
	const token = await tokenStore.create({
		userId,
		tokenHash: hashToken(generateToken("bt_")),
	});
	const store = createBridgeSessionStore(db);
	const created = await store.create({
		userId,
		tokenId: token.id,
		agentKind: "claude-code",
	});
	return created.id;
}

it("create defaults name/archivedAt/starred; rename sets and clears name, owner-only", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const id = await seedSession(alice);

	const created = await store.get(id);
	expect(created?.name).toBeNull();
	expect(created?.archivedAt).toBeNull();
	expect(created?.starred).toBe(false);

	await store.rename(id, bob, "hijacked");
	expect((await store.get(id))?.name).toBeNull();

	await store.rename(id, alice, "my run");
	expect((await store.get(id))?.name).toBe("my run");

	await store.rename(id, alice, null);
	expect((await store.get(id))?.name).toBeNull();
});

it("setArchived sets and clears archivedAt, owner-only", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const id = await seedSession(alice);

	await store.setArchived(id, bob, true);
	expect((await store.get(id))?.archivedAt).toBeNull();

	await store.setArchived(id, alice, true);
	expect((await store.get(id))?.archivedAt).toBeInstanceOf(Date);

	await store.setArchived(id, alice, false);
	expect((await store.get(id))?.archivedAt).toBeNull();
});

it("setStarred flips the flag, owner-only", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const id = await seedSession(alice);

	await store.setStarred(id, bob, true);
	expect((await store.get(id))?.starred).toBe(false);

	await store.setStarred(id, alice, true);
	expect((await store.get(id))?.starred).toBe(true);

	await store.setStarred(id, alice, false);
	expect((await store.get(id))?.starred).toBe(false);
});

it("deleteHard removes the session and its messages, owner-only", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const id = await seedSession(alice);
	await db
		.insert(bridgeMessages)
		.values([{ sessionId: id, seq: 1, event: { kind: "message" } }]);

	await store.deleteHard(id, bob);
	expect(await store.get(id)).not.toBeNull();

	await store.deleteHard(id, alice);
	expect(await store.get(id)).toBeNull();
	const orphaned = await db
		.select()
		.from(bridgeMessages)
		.where(eq(bridgeMessages.sessionId, id));
	expect(orphaned).toHaveLength(0);
});

it("listPageByUser excludes archived rows by default and pages only them with archived: true", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const keptId = await seedSession(alice);
	const archivedId = await seedSession(alice);
	await store.setArchived(archivedId, alice, true);

	const defaultPage = await store.listPageByUser(alice, { limit: 10 });
	expect(defaultPage.map((row) => row.id)).toEqual([keptId]);

	const archivedPage = await store.listPageByUser(alice, {
		limit: 10,
		archived: true,
	});
	expect(archivedPage.map((row) => row.id)).toEqual([archivedId]);
});

it("the archived page keeps keyset-cursor semantics", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const base = new Date("2026-07-01T00:00:00Z").getTime();
	const seededCount = 3;
	const stepMs = 1000;
	const ids: string[] = [];
	for (let i = 0; i < seededCount; i++) {
		const id = await seedSession(alice);
		await db
			.update(bridgeSessions)
			.set({ createdAt: new Date(base + i * stepMs) })
			.where(eq(bridgeSessions.id, id));
		await store.setArchived(id, alice, true);
		ids.push(id);
	}

	const first = await store.listPageByUser(alice, { limit: 2, archived: true });
	expect(first.map((row) => row.id)).toEqual([ids[2], ids[1]]);

	const lastOfPage = first.at(-1);
	const second = await store.listPageByUser(alice, {
		limit: 2,
		archived: true,
		before: {
			createdAt: lastOfPage?.createdAt ?? new Date(),
			id: lastOfPage?.id ?? "",
		},
	});
	expect(second.map((row) => row.id)).toEqual([ids[0]]);
});
