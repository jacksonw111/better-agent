import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createProfileStore } from "./profile-store";

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

it("ensureProfile creates on first access and is idempotent, starting at version 1", async () => {
	const store = createProfileStore(db);
	const userId = await seedUser("alice@x.com");

	const first = await store.ensureProfile(userId);
	expect(first.id).toBeTruthy();
	expect(first.userId).toBe(userId);
	expect(first.version).toBe(1);

	const second = await store.ensureProfile(userId);
	expect(second.id).toBe(first.id); // same row, not a duplicate
});

it("getProfile ensures the profile and returns empty relations initially", async () => {
	const store = createProfileStore(db);
	const userId = await seedUser("alice@x.com");

	const profile = await store.getProfile(userId);
	expect(profile.version).toBe(1);
	expect(profile.standards).toEqual([]);
	expect(profile.templates).toEqual([]);
});

it("bumpVersion increments and ensures a profile that does not exist yet", async () => {
	const store = createProfileStore(db);
	const userId = await seedUser("alice@x.com");

	await store.bumpVersion(userId); // no ensureProfile called first
	expect((await store.getProfile(userId)).version).toBe(2);

	await store.bumpVersion(userId);
	expect((await store.getProfile(userId)).version).toBe(3);
});

it("standards CRUD round-trips with defaults", async () => {
	const store = createProfileStore(db);
	const userId = await seedUser("alice@x.com");

	const created = await store.createStandard(userId, {
		title: "No console.log",
		body: "Remove console.log from production code.",
	});
	expect(created.enabled).toBe(true); // default
	expect(created.sortOrder).toBe(0); // default

	const updated = await store.updateStandard(userId, created.id, {
		title: "No console.log v2",
		enabled: false,
	});
	expect(updated?.title).toBe("No console.log v2");
	expect(updated?.enabled).toBe(false);
	expect(updated?.body).toBe("Remove console.log from production code.");

	await store.deleteStandard(userId, created.id);
	expect((await store.getProfile(userId)).standards).toEqual([]);
});

it("reorderStandards rewrites sort_order and getProfile returns them sorted", async () => {
	const store = createProfileStore(db);
	const userId = await seedUser("alice@x.com");
	const a = await store.createStandard(userId, { title: "A", body: "a" });
	const b = await store.createStandard(userId, { title: "B", body: "b" });
	const c = await store.createStandard(userId, { title: "C", body: "c" });

	await store.reorderStandards(userId, [c.id, a.id, b.id]);

	const { standards } = await store.getProfile(userId);
	expect(standards.map((s) => s.title)).toEqual(["C", "A", "B"]);
	expect(standards.map((s) => s.sortOrder)).toEqual([0, 1, 2]);
});

it("templates CRUD round-trips with jsonb scaffold + mcp defaults", async () => {
	const store = createProfileStore(db);
	const userId = await seedUser("alice@x.com");

	const created = await store.createTemplate(userId, { name: "Node service" });
	expect(created.scaffold).toEqual({ files: [], dirs: [] }); // jsonb default
	expect(created.mcpServerIds).toEqual([]); // jsonb default
	expect(created.description).toBeNull();
	expect(created.claudeMd).toBeNull();

	const updated = await store.updateTemplate(userId, created.id, {
		description: "A Node.js service",
		scaffold: {
			files: [{ path: "README.md", content: "# Hi" }],
			dirs: ["src"],
		},
		mcpServerIds: ["mcp-1"],
		claudeMd: "Use pnpm.",
	});
	expect(updated?.description).toBe("A Node.js service");
	expect(updated?.scaffold.files).toHaveLength(1);
	expect(updated?.scaffold.dirs).toEqual(["src"]);
	expect(updated?.mcpServerIds).toEqual(["mcp-1"]);
	expect(updated?.claudeMd).toBe("Use pnpm.");

	await store.deleteTemplate(userId, created.id);
	expect((await store.getProfile(userId)).templates).toEqual([]);
});

it("standard ops are owner-scoped: a non-owner cannot update or delete", async () => {
	const store = createProfileStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const std = await store.createStandard(alice, { title: "A", body: "a" });

	expect(
		await store.updateStandard(bob, std.id, { title: "hacked" })
	).toBeNull();
	await store.deleteStandard(bob, std.id);

	// Alice's standard survives Bob's attempts.
	const survivor = (await store.getProfile(alice)).standards[0];
	expect(survivor?.title).toBe("A");
});

it("template ops are owner-scoped: a non-owner cannot update or delete", async () => {
	const store = createProfileStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const tpl = await store.createTemplate(alice, { name: "T" });

	expect(
		await store.updateTemplate(bob, tpl.id, { name: "hacked" })
	).toBeNull();
	await store.deleteTemplate(bob, tpl.id);

	const survivor = (await store.getProfile(alice)).templates[0];
	expect(survivor?.name).toBe("T");
});

it("reorderStandards ignores ids that belong to another user's profile", async () => {
	const store = createProfileStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const aStd = await store.createStandard(alice, { title: "A", body: "a" });
	const bStd = await store.createStandard(bob, { title: "B", body: "b" });

	// Bob tries to reorder including Alice's id — hers must not move.
	await store.reorderStandards(bob, [aStd.id, bStd.id]);

	expect((await store.getProfile(alice)).standards[0]?.sortOrder).toBe(0);
	expect((await store.getProfile(bob)).standards[0]?.id).toBe(bStd.id);
});
