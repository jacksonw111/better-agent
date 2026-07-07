import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agents } from "../schema/agents";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createMemoryStore } from "./memory-store";

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

async function seedAgent(tokenHash: string): Promise<string> {
	const [row] = await db
		.insert(agents)
		.values({
			name: "Helper",
			description: "A helpful agent",
			systemPrompt: "You are helpful.",
			providerId: "anthropic",
			modelId: "claude-opus-4-5",
			tokenHash,
		})
		.returning();
	return row?.id ?? "";
}

it("create returns a row with id, timestamps and nullable description", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");

	const created = await store.create({ userId, name: "Prefs" });

	expect(created.id).toBeTruthy();
	expect(created.userId).toBe(userId);
	expect(created.name).toBe("Prefs");
	expect(created.description).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
});

it("get returns the created memory and null for a missing id", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");
	const created = await store.create({
		userId,
		name: "Docs",
		description: "shared notes",
	});

	expect((await store.get(created.id))?.description).toBe("shared notes");
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("listByUser scopes memories per owner", async () => {
	const store = createMemoryStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	await store.create({ userId: alice, name: "A1" });
	await store.create({ userId: alice, name: "A2" });
	await store.create({ userId: bob, name: "B1" });

	const aliceMemories = await store.listByUser(alice);
	expect(aliceMemories).toHaveLength(2);
	expect(aliceMemories.every((row) => row.userId === alice)).toBe(true);
	expect(await store.listByUser(bob)).toHaveLength(1);
});

it("delete is owner-scoped: another user's delete is a no-op", async () => {
	const store = createMemoryStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const created = await store.create({ userId: alice, name: "A1" });

	await store.delete(created.id, bob);
	expect(await store.get(created.id)).not.toBeNull();

	await store.delete(created.id, alice);
	expect(await store.get(created.id)).toBeNull();
});

it("assignAgent links a memory with the default read role", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");
	const agentId = await seedAgent("hash-a");
	const memory = await store.create({ userId, name: "Prefs" });

	await store.assignAgent({ agentId, memoryId: memory.id });

	const links = await store.listAgentMemories(agentId);
	expect(links).toHaveLength(1);
	expect(links[0]?.memoryId).toBe(memory.id);
	expect(links[0]?.role).toBe("read");
});

it("assignAgent upserts the role on re-assign", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");
	const agentId = await seedAgent("hash-a");
	const memory = await store.create({ userId, name: "Prefs" });

	await store.assignAgent({ agentId, memoryId: memory.id });
	await store.assignAgent({
		agentId,
		memoryId: memory.id,
		role: "read_write",
	});

	const links = await store.listAgentMemories(agentId);
	expect(links).toHaveLength(1);
	expect(links[0]?.role).toBe("read_write");
});

it("unassignAgent removes the link", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");
	const agentId = await seedAgent("hash-a");
	const memory = await store.create({ userId, name: "Prefs" });
	await store.assignAgent({ agentId, memoryId: memory.id });

	await store.unassignAgent(agentId, memory.id);

	expect(await store.listAgentMemories(agentId)).toHaveLength(0);
});

it("listAgentMemories scopes links per agent", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");
	const agentA = await seedAgent("hash-a");
	const agentB = await seedAgent("hash-b");
	const shared = await store.create({ userId, name: "Shared" });
	const solo = await store.create({ userId, name: "Solo" });
	await store.assignAgent({ agentId: agentA, memoryId: shared.id });
	await store.assignAgent({ agentId: agentA, memoryId: solo.id });
	await store.assignAgent({ agentId: agentB, memoryId: shared.id });

	expect(await store.listAgentMemories(agentA)).toHaveLength(2);
	expect(await store.listAgentMemories(agentB)).toHaveLength(1);
});
