import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	buildHarness,
	type Harness,
	seedAgent,
	seedUser,
} from "./memory-test-helpers";

const EMBEDDING_DIMENSIONS = 1024;

let h: Harness;
let client: PGlite;

beforeEach(async () => {
	h = await buildHarness();
	client = h.client;
});

afterEach(async () => {
	await client.close();
});

it("create/list/get scope memories to the owner", async () => {
	const alice = await seedUser(h.db, "alice");
	const aliceClient = h.clientFor(alice);

	const created = await aliceClient.memory.createMemory({ name: "Prefs" });
	expect(created.userId).toBe(alice);

	const list = await aliceClient.memory.listMemories();
	expect(list).toHaveLength(1);
	expect((await aliceClient.memory.getMemory({ id: created.id })).name).toBe(
		"Prefs"
	);
});

it("another user cannot get or delete a memory they do not own", async () => {
	const alice = await seedUser(h.db, "alice");
	const bob = await seedUser(h.db, "bob");
	const memory = await h
		.clientFor(alice)
		.memory.createMemory({ name: "Prefs" });
	const bobClient = h.clientFor(bob);

	await expect(bobClient.memory.getMemory({ id: memory.id })).rejects.toThrow();
	await expect(
		bobClient.memory.deleteMemory({ id: memory.id })
	).rejects.toThrow();
	// Alice's memory survives Bob's failed delete.
	expect(
		await h.clientFor(alice).memory.getMemory({ id: memory.id })
	).toBeTruthy();
});

it("deleteMemory cascades items + links", async () => {
	const alice = await seedUser(h.db, "alice");
	const agentId = await seedAgent(h.db, alice, "hash-a");
	const c = h.clientFor(alice);
	const memory = await c.memory.createMemory({ name: "Prefs" });
	await c.memory.addItem({ memoryId: memory.id, content: "typescript rocks" });
	await c.memory.assignMemory({ memoryId: memory.id, agentId, role: "read" });

	await c.memory.deleteMemory({ id: memory.id });

	expect(await c.memory.listMemories()).toHaveLength(0);
	expect(await c.memory.listAssigned({ agentId })).toHaveLength(0);
});

it("addItem embeds content and persists a retrievable 1024-dim item", async () => {
	const alice = await seedUser(h.db, "alice");
	const agentId = await seedAgent(h.db, alice, "hash-a");
	const c = h.clientFor(alice);
	const memory = await c.memory.createMemory({ name: "Prefs" });
	await c.memory.addItem({ memoryId: memory.id, content: "typescript rocks" });
	await c.memory.assignMemory({ memoryId: memory.id, agentId, role: "read" });

	// The fake produces 1024-length vectors, so search over the persisted
	// embedding returns the item — proving the embedding row was stored.
	const hits = await c.memory.search({ agentId, query: "typescript rocks" });
	expect(hits).toHaveLength(1);
	expect(hits[0]?.content).toBe("typescript rocks");
	expect(await h.services.embeddingClient?.embed("x")).toHaveLength(
		EMBEDDING_DIMENSIONS
	);
});

it("assigns a memory to a web agent and lists it with its role", async () => {
	const alice = await seedUser(h.db, "alice");
	const agentId = await seedAgent(h.db, alice, "hash-a");
	const c = h.clientFor(alice);
	const memory = await c.memory.createMemory({ name: "Prefs" });

	await c.memory.assignMemory({
		memoryId: memory.id,
		agentId,
		role: "read_write",
	});

	const assigned = await c.memory.listAssigned({ agentId });
	expect(assigned).toEqual([
		{
			memoryId: memory.id,
			role: "read_write",
			name: "Prefs",
			description: null,
		},
	]);
});

it("search is scoped to the agent's assigned memories only", async () => {
	const alice = await seedUser(h.db, "alice");
	const agentId = await seedAgent(h.db, alice, "hash-a");
	const c = h.clientFor(alice);
	const assignedMem = await c.memory.createMemory({ name: "Assigned" });
	const otherMem = await c.memory.createMemory({ name: "Other" });
	// Identical text in BOTH memories — only the assigned one may surface.
	await c.memory.addItem({ memoryId: assignedMem.id, content: "shared text" });
	await c.memory.addItem({ memoryId: otherMem.id, content: "shared text" });
	await c.memory.assignMemory({ memoryId: assignedMem.id, agentId });

	const hits = await c.memory.search({ agentId, query: "shared text", k: 10 });
	expect(hits).toHaveLength(1);
	expect(hits[0]?.memoryId).toBe(assignedMem.id);
});

it("deleteItem soft-deletes so the item drops out of search + listItems", async () => {
	const alice = await seedUser(h.db, "alice");
	const agentId = await seedAgent(h.db, alice, "hash-a");
	const c = h.clientFor(alice);
	const memory = await c.memory.createMemory({ name: "Prefs" });
	const item = await c.memory.addItem({
		memoryId: memory.id,
		content: "typescript rocks",
	});
	await c.memory.assignMemory({ memoryId: memory.id, agentId });

	await c.memory.deleteItem({ itemId: item.id });

	expect(await c.memory.listItems({ memoryId: memory.id })).toHaveLength(0);
	expect(
		await c.memory.search({ agentId, query: "typescript rocks" })
	).toHaveLength(0);
});

it("rejects assign/search targeting an agent the caller does not own", async () => {
	const alice = await seedUser(h.db, "alice");
	const bob = await seedUser(h.db, "bob");
	const bobAgent = await seedAgent(h.db, bob, "hash-b");
	const c = h.clientFor(alice);
	const memory = await c.memory.createMemory({ name: "Prefs" });

	await expect(
		c.memory.assignMemory({ memoryId: memory.id, agentId: bobAgent })
	).rejects.toThrow();
	await expect(
		c.memory.search({ agentId: bobAgent, query: "x" })
	).rejects.toThrow();
});
