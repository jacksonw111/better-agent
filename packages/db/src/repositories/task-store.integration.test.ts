import type { TaskInsert } from "@better-agent/agent/task-ports";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { computers } from "../schema/computers";
import { tasks } from "../schema/tasks";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createTaskStore } from "./task-store";

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

async function seedComputer(userId: string): Promise<string> {
	const [row] = await db
		.insert(computers)
		.values({ userId, publicKeyPem: "pem", name: "John's MacBook" })
		.returning();
	return row?.id ?? "";
}

function taskInput(userId: string, computerId: string): TaskInsert {
	return {
		agentKind: "claude-code",
		computerId,
		description: "Fix the flaky login test /research",
		name: "Fix login flake",
		openingMessage:
			"Fix the flaky login test /research\n\n## Execution context",
		repositoryFullName: null,
		repositoryUrl: null,
		userId,
	};
}

it("insert persists a Task as active and getById returns it for the owner", async () => {
	const store = createTaskStore(db);
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId);
	const input = taskInput(userId, computerId);

	const created = await store.insert(input);

	expect(created.id).toBeTruthy();
	expect(created.status).toBe("active");
	expect(created.userId).toBe(userId);
	expect(created.computerId).toBe(computerId);
	expect(created.agentKind).toBe("claude-code");
	expect(created.name).toBe("Fix login flake");
	expect(created.description).toBe(input.description);
	expect(created.openingMessage).toBe(input.openingMessage);
	expect(created.repositoryFullName).toBeNull();
	expect(created.repositoryUrl).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
	expect(created.updatedAt).toBeInstanceOf(Date);

	expect(await store.getById(created.id, userId)).toEqual(created);
});

it("insert keeps repository fields when provided", async () => {
	const store = createTaskStore(db);
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId);

	const created = await store.insert({
		...taskInput(userId, computerId),
		repositoryFullName: "acme/app",
		repositoryUrl: "https://github.com/acme/app",
	});

	expect(created.repositoryFullName).toBe("acme/app");
	expect(created.repositoryUrl).toBe("https://github.com/acme/app");
});

it("getById is owner-scoped: null for another user or an unknown id", async () => {
	const store = createTaskStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(taskInput(alice, computerId));

	expect(await store.getById(created.id, bob)).toBeNull();
	expect(
		await store.getById("00000000-0000-4000-8000-000000000000", alice)
	).toBeNull();
});

it("listByUser returns only the owner's Tasks, newest first", async () => {
	const store = createTaskStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const aliceComputer = await seedComputer(alice);
	const bobComputer = await seedComputer(bob);

	// Explicit createdAt (inserted oldest-last) proves the sort really is by
	// createdAt — PGlite's now() can collide for fast sequential inserts.
	const seedTaskAt = async (name: string, createdAt: Date) => {
		const [row] = await db
			.insert(tasks)
			.values({ ...taskInput(alice, aliceComputer), name, createdAt })
			.returning();
		return row?.id ?? "";
	};
	const newest = await seedTaskAt("Newest", new Date("2026-07-15T12:02:00Z"));
	const oldest = await seedTaskAt("Oldest", new Date("2026-07-15T12:00:00Z"));
	const middle = await seedTaskAt("Middle", new Date("2026-07-15T12:01:00Z"));
	await store.insert(taskInput(bob, bobComputer));

	const rows = await store.listByUser(alice);
	expect(rows.map((row) => row.id)).toEqual([newest, middle, oldest]);
	expect(await store.listByUser(bob)).toHaveLength(1);
});

it("updateStatus is owner-scoped and persists the new status", async () => {
	const store = createTaskStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(taskInput(alice, computerId));

	expect(await store.updateStatus(created.id, bob, "archived")).toBe(false);
	expect((await store.getById(created.id, alice))?.status).toBe("active");

	expect(await store.updateStatus(created.id, alice, "completed")).toBe(true);
	expect((await store.getById(created.id, alice))?.status).toBe("completed");
});
