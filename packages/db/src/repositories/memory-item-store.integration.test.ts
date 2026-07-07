import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { memories } from "../schema/memory";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createMemoryItemStore } from "./memory-item-store";

const EMBEDDING_DIMENSIONS = 768;
const MODEL = "bge-base";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

// A 768-d unit-ish vector whose direction is set by its leading components; the
// trailing dims stay zero so cosine distance is driven by `lead` alone.
function vec(...lead: number[]): number[] {
	const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
	for (const [i, value] of lead.entries()) {
		values[i] = value;
	}
	return values;
}

async function seedMemory(name: string): Promise<string> {
	const [user] = await db
		.insert(users)
		.values({ email: `${name}@x.com` })
		.returning();
	const [memory] = await db
		.insert(memories)
		.values({ userId: user?.id ?? "", name })
		.returning();
	return memory?.id ?? "";
}

it("add persists an item with its defaults and embedding", async () => {
	const store = createMemoryItemStore(db);
	const memoryId = await seedMemory("m");

	const item = await store.add({
		memoryId,
		content: "likes TypeScript",
		embedding: vec(1, 0),
		model: MODEL,
	});

	expect(item.id).toBeTruthy();
	expect(item.content).toBe("likes TypeScript");
	expect(item.source).toBe("user");
	expect(item.importance).toBeCloseTo(0.5);
	expect(item.validTo).toBeNull();
});

it("listCurrent returns only non-soft-deleted items", async () => {
	const store = createMemoryItemStore(db);
	const memoryId = await seedMemory("m");
	const a = await store.add({
		memoryId,
		content: "a",
		embedding: vec(1, 0),
		model: MODEL,
	});
	await store.add({
		memoryId,
		content: "b",
		embedding: vec(0, 1),
		model: MODEL,
	});

	expect(await store.listCurrent(memoryId)).toHaveLength(2);

	await store.softDelete(a.id);

	const current = await store.listCurrent(memoryId);
	expect(current).toHaveLength(1);
	expect(current[0]?.content).toBe("b");
});

it("search returns nearest current items filtered by memory_id", async () => {
	const store = createMemoryItemStore(db);
	const memoryA = await seedMemory("a");
	const memoryB = await seedMemory("b");
	const near = await store.add({
		memoryId: memoryA,
		content: "near",
		embedding: vec(1, 0),
		model: MODEL,
	});
	await store.add({
		memoryId: memoryA,
		content: "far",
		embedding: vec(0, 1),
		model: MODEL,
	});
	// Closest of all to the query, but in a memory we do NOT search.
	await store.add({
		memoryId: memoryB,
		content: "other-memory",
		embedding: vec(1, 0),
		model: MODEL,
	});

	const results = await store.search({
		embedding: vec(1, 0),
		memoryIds: [memoryA],
		k: 2,
	});

	expect(results.map((r) => r.content)).toEqual(["near", "far"]);
	expect(results.every((r) => r.memoryId === memoryA)).toBe(true);

	const top = await store.search({
		embedding: vec(1, 0),
		memoryIds: [memoryA],
		k: 1,
	});
	expect(top).toHaveLength(1);
	expect(top[0]?.id).toBe(near.id);
});

it("search excludes soft-deleted items", async () => {
	const store = createMemoryItemStore(db);
	const memoryId = await seedMemory("m");
	const a = await store.add({
		memoryId,
		content: "a",
		embedding: vec(1, 0),
		model: MODEL,
	});
	await store.softDelete(a.id);

	const results = await store.search({
		embedding: vec(1, 0),
		memoryIds: [memoryId],
		k: 5,
	});
	expect(results).toHaveLength(0);
});

it("search bumps last_accessed_at when asked", async () => {
	const store = createMemoryItemStore(db);
	const memoryId = await seedMemory("m");
	const item = await store.add({
		memoryId,
		content: "a",
		embedding: vec(1, 0),
		model: MODEL,
	});
	expect(item.lastAccessedAt).toBeNull();

	await store.search({
		embedding: vec(1, 0),
		memoryIds: [memoryId],
		k: 1,
		bumpAccessedAt: true,
	});

	const [current] = await store.listCurrent(memoryId);
	expect(current?.lastAccessedAt).toBeInstanceOf(Date);
});

it("search returns nothing for an empty memory-id set", async () => {
	const store = createMemoryItemStore(db);
	const results = await store.search({
		embedding: vec(1, 0),
		memoryIds: [],
		k: 5,
	});
	expect(results).toHaveLength(0);
});
