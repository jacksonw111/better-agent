import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { computers } from "../schema/computers";
import { projects } from "../schema/projects";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createMemoryStore } from "./memory-store";

// DP2 scope persistence for the memory store: create defaults, project-scope
// round-trips, and the owner-scoped setScope re-home. Split from
// memory-store.integration.test.ts so both files stay under the per-file cap.

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

async function seedProject(userId: string, name: string): Promise<string> {
	const [computer] = await db
		.insert(computers)
		.values({ userId, name: `${name}-box`, publicKeyPem: "pk" })
		.returning();
	const [project] = await db
		.insert(projects)
		.values({
			userId,
			computerId: computer?.id ?? "",
			name,
			repoFullName: `acme/${name}`,
			repoCloneUrl: `https://example.com/${name}.git`,
		})
		.returning();
	return project?.id ?? "";
}

it("create defaults to global scope with a null projectId (DP2)", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");

	const created = await store.create({ userId, name: "Prefs" });

	expect(created.scope).toBe("global");
	expect(created.projectId).toBeNull();
});

it("create stores a project scope and drops projectId for a global one", async () => {
	const store = createMemoryStore(db);
	const userId = await seedUser("alice@x.com");
	const projectId = await seedProject(userId, "alpha");

	const project = await store.create({
		userId,
		name: "A-notes",
		scope: "project",
		projectId,
	});
	expect(project.scope).toBe("project");
	expect(project.projectId).toBe(projectId);

	// A global memory never keeps a projectId, even if one is passed.
	const global = await store.create({
		userId,
		name: "Global",
		scope: "global",
		projectId,
	});
	expect(global.projectId).toBeNull();
});

it("setScope re-homes global↔project and clears/sets projectId, owner-scoped", async () => {
	const store = createMemoryStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const projectId = await seedProject(alice, "alpha");
	const memory = await store.create({ userId: alice, name: "Prefs" });

	const toProject = await store.setScope({
		id: memory.id,
		userId: alice,
		scope: "project",
		projectId,
	});
	expect(toProject?.scope).toBe("project");
	expect(toProject?.projectId).toBe(projectId);

	const back = await store.setScope({
		id: memory.id,
		userId: alice,
		scope: "global",
		projectId: null,
	});
	expect(back?.scope).toBe("global");
	expect(back?.projectId).toBeNull();

	// A non-owner's setScope changes nothing and returns null.
	const denied = await store.setScope({
		id: memory.id,
		userId: bob,
		scope: "project",
		projectId,
	});
	expect(denied).toBeNull();
	expect((await store.get(memory.id))?.scope).toBe("global");
});
