import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
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

function createInput(userId: string, name?: string) {
	const token = generateToken("bt_");
	return {
		userId,
		name,
		agentKind: "claude-code" as const,
		token,
		tokenHash: hashToken(token),
		last4: token.slice(-4),
	};
}

it("create persists agentKind + raw token and returns them without the hash", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");
	const input = createInput(userId, "laptop");

	const created = await store.create(input);

	expect(created.id).toBeTruthy();
	expect(created.userId).toBe(userId);
	expect(created.name).toBe("laptop");
	expect(created.agentKind).toBe("claude-code");
	expect(created.token).toBe(input.token);
	expect(created.last4).toBe(input.token.slice(-4));
	expect(created.createdAt).toBeInstanceOf(Date);
	expect(created.revokedAt).toBeNull();
	expect(created).not.toHaveProperty("tokenHash");
});

it("create stores a chosen non-default agentKind", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");

	const created = await store.create({
		...createInput(userId),
		agentKind: "codex",
	});

	expect(created.agentKind).toBe("codex");
});

it("getById returns the owner's raw token + agentKind, and null for others", async () => {
	const store = createBridgeTokenStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const input = createInput(alice, "laptop");
	const created = await store.create(input);

	const found = await store.getById(created.id, alice);
	expect(found?.token).toBe(input.token);
	expect(found?.agentKind).toBe("claude-code");

	expect(await store.getById(created.id, bob)).toBeNull();
});

it("findByHash resolves an active token and returns null for unknown hashes", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");
	const input = createInput(userId);
	const created = await store.create(input);

	const found = await store.findByHash(input.tokenHash);
	expect(found).toEqual({ id: created.id, userId, revokedAt: null });
	expect(await store.findByHash("nope")).toBeNull();
});

it("listByUser scopes tokens per owner", async () => {
	const store = createBridgeTokenStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	await store.create(createInput(alice));
	await store.create(createInput(alice));
	await store.create(createInput(bob));

	const aliceTokens = await store.listByUser(alice);
	expect(aliceTokens).toHaveLength(2);
	expect(aliceTokens.every((row) => row.userId === alice)).toBe(true);
	expect(await store.listByUser(bob)).toHaveLength(1);
});

it("deleteAgent removes the token and all of its sessions", async () => {
	const store = createBridgeTokenStore(db);
	const sessionStore = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const token = await store.create(createInput(userId));
	const session = await sessionStore.create({
		userId,
		tokenId: token.id,
		agentKind: "claude-code",
	});

	await store.deleteAgent(token.id, userId);

	expect(await store.getById(token.id, userId)).toBeNull();
	expect(await sessionStore.listByUser(userId)).toHaveLength(0);
	expect(await sessionStore.get(session.id)).toBeNull();
});

it("deleteAgent only removes the caller's own token", async () => {
	const store = createBridgeTokenStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const token = await store.create(createInput(alice));

	await store.deleteAgent(token.id, bob);
	expect(await store.getById(token.id, alice)).not.toBeNull();

	await store.deleteAgent(token.id, alice);
	expect(await store.getById(token.id, alice)).toBeNull();
});

it("create rejects a duplicate token hash", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");
	const input = createInput(userId);
	await store.create(input);
	await expect(
		store.create({ ...createInput(userId), tokenHash: input.tokenHash })
	).rejects.toThrow();
});

it("updateConfig persists the config and getById returns it; null for other users", async () => {
	const store = createBridgeTokenStore(db);
	const userId = await seedUser("alice@x.com");
	const created = await store.create(createInput(userId, "laptop"));

	const updated = await store.updateConfig(created.id, userId, {
		appendSystemPrompt: "Be concise.",
		maxTurns: 7,
	});

	expect(updated?.config).toEqual({
		appendSystemPrompt: "Be concise.",
		maxTurns: 7,
	});
	const refetched = await store.getById(created.id, userId);
	expect(refetched?.config).toEqual({
		appendSystemPrompt: "Be concise.",
		maxTurns: 7,
	});
	// A different user's updateConfig is a no-op (returns null), leaving the
	// row untouched.
	const bob = await seedUser("bob@x.com");
	expect(await store.updateConfig(created.id, bob, {})).toBeNull();
	expect((await store.getById(created.id, userId))?.config).toEqual({
		appendSystemPrompt: "Be concise.",
		maxTurns: 7,
	});
});
