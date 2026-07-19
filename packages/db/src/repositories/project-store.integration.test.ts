import type { ProjectInsert } from "@better-agent/agent/project-ports";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { computers } from "../schema/computers";
import { projects } from "../schema/projects";
import { tasks } from "../schema/tasks";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createProjectStore } from "./project-store";

// Q1: the Project store — a long-lived per-Computer repository checkout.
// Covers the created→cloning→ready/error state machine writes, the
// clone-delivery queue derivation (listCreatedByComputer) and the owner /
// computer scoping rules.

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

function projectInput(userId: string, computerId: string): ProjectInsert {
	return {
		computerId,
		encryptedToken: "iv:tag:ciphertext",
		name: "Better Agent",
		repoCloneUrl: "https://github.com/acme/better-agent.git",
		repoFullName: "acme/better-agent",
		tokenLast4: "wxyz",
		userId,
	};
}

it("insert persists a Project as created and getById returns it for the owner", async () => {
	const store = createProjectStore(db);
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId);

	const created = await store.insert(projectInput(userId, computerId));

	expect(created.id).toBeTruthy();
	expect(created.status).toBe("created");
	expect(created.name).toBe("Better Agent");
	expect(created.repoFullName).toBe("acme/better-agent");
	expect(created.repoCloneUrl).toBe("https://github.com/acme/better-agent.git");
	expect(created.encryptedToken).toBe("iv:tag:ciphertext");
	expect(created.tokenLast4).toBe("wxyz");
	expect(created.errorMessage).toBeNull();
	expect(created.localPath).toBeNull();
	expect(await store.getById(created.id, userId)).toEqual(created);
});

it("insert accepts a token-less Project (public repository)", async () => {
	const store = createProjectStore(db);
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId);

	const created = await store.insert({
		...projectInput(userId, computerId),
		encryptedToken: null,
		tokenLast4: null,
	});

	expect(created.encryptedToken).toBeNull();
	expect(created.tokenLast4).toBeNull();
});

it("getById is owner-scoped and getByIdForComputer is computer-scoped", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const aliceComputer = await seedComputer(alice);
	const bobComputer = await seedComputer(bob);
	const created = await store.insert(projectInput(alice, aliceComputer));

	expect(await store.getById(created.id, bob)).toBeNull();
	expect(await store.getByIdForComputer(created.id, aliceComputer)).toEqual(
		created
	);
	expect(await store.getByIdForComputer(created.id, bobComputer)).toBeNull();
});

it("listByComputer returns only that owner+computer's Projects, newest first", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const aliceComputer = await seedComputer(alice);
	const bobComputer = await seedComputer(bob);

	const seedProjectAt = async (name: string, createdAt: Date) => {
		const [row] = await db
			.insert(projects)
			.values({ ...projectInput(alice, aliceComputer), name, createdAt })
			.returning();
		return row?.id ?? "";
	};
	const newest = await seedProjectAt(
		"Newest",
		new Date("2026-07-15T12:02:00Z")
	);
	const oldest = await seedProjectAt(
		"Oldest",
		new Date("2026-07-15T12:00:00Z")
	);
	await store.insert(projectInput(bob, bobComputer));

	const rows = await store.listByComputer(alice, aliceComputer);
	expect(rows.map((row) => row.id)).toEqual([newest, oldest]);
	expect(await store.listByComputer(alice, bobComputer)).toEqual([]);
});

it("listCreatedByComputer is the clone queue: created rows only, oldest first", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const computerId = await seedComputer(alice);

	const seedProjectAt = async (name: string, createdAt: Date) => {
		const [row] = await db
			.insert(projects)
			.values({ ...projectInput(alice, computerId), name, createdAt })
			.returning();
		return row?.id ?? "";
	};
	const second = await seedProjectAt(
		"Second",
		new Date("2026-07-15T12:01:00Z")
	);
	const first = await seedProjectAt("First", new Date("2026-07-15T12:00:00Z"));

	expect(
		(await store.listCreatedByComputer(computerId)).map((row) => row.id)
	).toEqual([first, second]);

	// The ack flips a row to cloning, which removes it from the queue.
	await store.updateStatus(first, { status: "cloning" });
	expect(
		(await store.listCreatedByComputer(computerId)).map((row) => row.id)
	).toEqual([second]);
});

it("updateStatus persists the ready+localPath and error+message transitions", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(projectInput(alice, computerId));

	await store.updateStatus(created.id, { status: "cloning" });
	expect((await store.getById(created.id, alice))?.status).toBe("cloning");

	await store.updateStatus(created.id, {
		localPath: "/Users/alice/.better-agent/projects/abcd1234-better-agent",
		status: "ready",
	});
	const ready = await store.getById(created.id, alice);
	expect(ready?.status).toBe("ready");
	expect(ready?.localPath).toBe(
		"/Users/alice/.better-agent/projects/abcd1234-better-agent"
	);

	await store.updateStatus(created.id, {
		errorMessage: "fatal: repository not found",
		status: "error",
	});
	const failed = await store.getById(created.id, alice);
	expect(failed?.status).toBe("error");
	expect(failed?.errorMessage).toBe("fatal: repository not found");
	// The earlier localPath was not part of the update — it stays untouched.
	expect(failed?.localPath).toBe(
		"/Users/alice/.better-agent/projects/abcd1234-better-agent"
	);

	expect(
		await store.updateStatus("00000000-0000-4000-8000-000000000000", {
			status: "cloning",
		})
	).toBe(false);
});

it("delete is owner-scoped and removes only the DB row", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(projectInput(alice, computerId));

	expect(await store.delete(created.id, bob)).toBe(false);
	expect(await store.getById(created.id, alice)).toEqual(created);

	expect(await store.delete(created.id, alice)).toBe(true);
	expect(await store.getById(created.id, alice)).toBeNull();
});

async function seedTask(
	userId: string,
	computerId: string,
	projectId: string
): Promise<string> {
	const [row] = await db
		.insert(tasks)
		.values({
			agentKind: "claude_code",
			computerId,
			description: "Fix the flaky test",
			name: "Fix the flaky test",
			openingMessage: "Fix the flaky test",
			projectId,
			userId,
		})
		.returning();
	return row?.id ?? "";
}

it("delete detaches the project's sessions: tasks survive with projectId null", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(projectInput(alice, computerId));
	const taskId = await seedTask(alice, computerId, created.id);

	expect(await store.delete(created.id, alice)).toBe(true);
	expect(await store.getById(created.id, alice)).toBeNull();

	// The chat history outlives the project — the task row stays, detached.
	const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
	expect(task).toBeDefined();
	expect(task?.projectId).toBeNull();
});

it("a non-owner delete leaves the project's tasks attached", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(projectInput(alice, computerId));
	const taskId = await seedTask(alice, computerId, created.id);

	expect(await store.delete(created.id, bob)).toBe(false);

	const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
	expect(task?.projectId).toBe(created.id);
});
