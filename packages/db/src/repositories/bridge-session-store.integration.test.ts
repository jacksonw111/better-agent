import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { bridgeSessions } from "../schema/bridge";
import { createTestDb, type TestDb } from "../testing/test-db";
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

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

async function seedToken(userId: string): Promise<string> {
	const tokenStore = createBridgeTokenStore(db);
	const created = await tokenStore.create({
		userId,
		tokenHash: hashToken(generateToken("bt_")),
	});
	return created.id;
}

it("create returns an active row with generated id and timestamps", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);

	const created = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
		label: "repo-a",
	});

	expect(created.id).toBeTruthy();
	expect(created.userId).toBe(userId);
	expect(created.tokenId).toBe(tokenId);
	expect(created.agentKind).toBe("claude-code");
	expect(created.label).toBe("repo-a");
	expect(created.status).toBe("active");
	expect(created.createdAt).toBeInstanceOf(Date);
	expect(created.lastSeenAt).toBeInstanceOf(Date);
});

it("get returns the created session and null for a missing id", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);
	const created = await store.create({
		userId,
		tokenId,
		agentKind: "opencode",
	});

	expect((await store.get(created.id))?.agentKind).toBe("opencode");
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("listByUser scopes sessions per owner", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const aliceToken = await seedToken(alice);
	const bobToken = await seedToken(bob);

	await store.create({
		userId: alice,
		tokenId: aliceToken,
		agentKind: "codex",
	});
	await store.create({
		userId: alice,
		tokenId: aliceToken,
		agentKind: "codex",
	});
	await store.create({ userId: bob, tokenId: bobToken, agentKind: "codex" });

	const aliceSessions = await store.listByUser(alice);
	expect(aliceSessions).toHaveLength(2);
	expect(aliceSessions.every((row) => row.userId === alice)).toBe(true);
	expect(await store.listByUser(bob)).toHaveLength(1);
});

// P2-T1: listPageByUser's keyset pagination. createdAt isn't injectable via
// create(), so timestamps are set directly for deterministic ordering.
async function seedSessionAt(
	store: ReturnType<typeof createBridgeSessionStore>,
	userId: string,
	tokenId: string,
	createdAt: Date
): Promise<string> {
	const created = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
	});
	await db
		.update(bridgeSessions)
		.set({ createdAt })
		.where(eq(bridgeSessions.id, created.id));
	return created.id;
}

it("listPageByUser pages newest-first with a stable (createdAt, id) cursor", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);
	const base = new Date("2026-07-01T00:00:00Z").getTime();
	const oldest = await seedSessionAt(store, userId, tokenId, new Date(base));
	const middle = await seedSessionAt(
		store,
		userId,
		tokenId,
		new Date(base + 1000)
	);
	const newest = await seedSessionAt(
		store,
		userId,
		tokenId,
		new Date(base + 2000)
	);

	const first = await store.listPageByUser(userId, { limit: 2 });
	expect(first.map((row) => row.id)).toEqual([newest, middle]);

	const lastOfPage = first.at(-1);
	const second = await store.listPageByUser(userId, {
		limit: 2,
		before: { createdAt: lastOfPage?.createdAt ?? new Date(), id: middle },
	});
	expect(second.map((row) => row.id)).toEqual([oldest]);
});

it("listPageByUser breaks createdAt ties by id descending, and cursors across the tie", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);
	const sameInstant = new Date("2026-07-01T00:00:00Z");
	const a = await seedSessionAt(store, userId, tokenId, sameInstant);
	const b = await seedSessionAt(store, userId, tokenId, sameInstant);
	const [higherId, lowerId] = a > b ? [a, b] : [b, a];

	const first = await store.listPageByUser(userId, { limit: 1 });
	expect(first[0]?.id).toBe(higherId);

	const second = await store.listPageByUser(userId, {
		limit: 1,
		before: { createdAt: sameInstant, id: higherId },
	});
	expect(second[0]?.id).toBe(lowerId);
});

it("listPageByUser is scoped to the user and respects limit", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const aliceToken = await seedToken(alice);
	const bobToken = await seedToken(bob);
	await store.create({ userId: alice, tokenId: aliceToken, agentKind: "pi" });
	await store.create({ userId: bob, tokenId: bobToken, agentKind: "pi" });

	const page = await store.listPageByUser(alice, { limit: 10 });
	expect(page).toHaveLength(1);
	expect(page[0]?.userId).toBe(alice);
});

// touch() throttles to one write per 15s (see TOUCH_THROTTLE_SECONDS in
// bridge-session-store.ts), so these back-date lastSeenAt directly (bypassing
// the store) to exercise both sides of the guard. App-side timestamp, same
// clock touchSession compares against (it also uses `new Date()`).
async function backdateLastSeenAt(seconds: number): Promise<string> {
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);
	const store = createBridgeSessionStore(db);
	const created = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
	});
	const msPerSecond = 1000;
	await db
		.update(bridgeSessions)
		.set({ lastSeenAt: new Date(Date.now() - seconds * msPerSecond) })
		.where(eq(bridgeSessions.id, created.id));
	return created.id;
}

it("touch bumps lastSeenAt once the throttle window has elapsed", async () => {
	const store = createBridgeSessionStore(db);
	const id = await backdateLastSeenAt(20);
	const before = await store.get(id);

	await store.touch(id);

	const after = await store.get(id);
	expect(after?.lastSeenAt.getTime()).toBeGreaterThan(
		before?.lastSeenAt.getTime() ?? 0
	);
});

it("touch is throttled: a call inside the window is a no-op", async () => {
	const store = createBridgeSessionStore(db);
	const id = await backdateLastSeenAt(5);
	const before = await store.get(id);

	await store.touch(id);

	const after = await store.get(id);
	expect(after?.lastSeenAt.getTime()).toBe(before?.lastSeenAt.getTime());
});

it("end sets status to ended and only for the owner", async () => {
	const store = createBridgeSessionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const tokenId = await seedToken(alice);
	const created = await store.create({
		userId: alice,
		tokenId,
		agentKind: "claude-code",
	});

	await store.end(created.id, bob);
	expect((await store.get(created.id))?.status).toBe("active");

	await store.end(created.id, alice);
	expect((await store.get(created.id))?.status).toBe("ended");
});

it("create defaults agentSessionId to null; setAgentSessionId records it", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);
	const created = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
	});
	expect(created.agentSessionId).toBeNull();

	await store.setAgentSessionId(created.id, "claude-session-abc");

	const after = await store.get(created.id);
	expect(after?.agentSessionId).toBe("claude-session-abc");
});

it("create with runId persists the bridge_sessions.run_id back-reference (S2-T2)", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);
	const runId = crypto.randomUUID();

	const created = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
		runId,
	});
	expect(created.runId).toBe(runId);

	const [raw] = await db
		.select({ runId: bridgeSessions.runId })
		.from(bridgeSessions)
		.where(eq(bridgeSessions.id, created.id));
	expect(raw?.runId).toBe(runId);

	// Omitted (every pre-Run caller): stays null.
	const bare = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
	});
	expect(bare.runId).toBeNull();
});
