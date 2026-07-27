import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { computers } from "../schema/computers";
import { projects } from "../schema/projects";
import { ptySessions } from "../schema/pty";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createPtySessionStore } from "./pty-session-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const USER_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

async function seedUser(id: string): Promise<void> {
	await db.insert(users).values({
		id,
		email: `${id}@example.com`,
	});
}

async function seedComputer(id: string, userId: string): Promise<void> {
	await db.insert(computers).values({
		id,
		userId,
		publicKeyPem: "pem",
		name: "box",
	});
}

const COMPUTER_1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const COMPUTER_2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

async function seedGraph(): Promise<void> {
	await seedUser(USER_1);
	await seedUser(USER_2);
	await seedComputer(COMPUTER_1, USER_1);
	await seedComputer(COMPUTER_2, USER_1);
}

function baseInsert(
	over: Partial<
		Parameters<ReturnType<typeof createPtySessionStore>["create"]>[0]
	> = {}
) {
	return {
		userId: USER_1,
		computerId: COMPUTER_1,
		projectId: null,
		agentKind: "claude-code",
		title: "Session 7/26 14:30",
		...over,
	};
}

it("create persists an active session with the given fields", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	expect(row.id).toBeTruthy();
	expect(row.status).toBe("active");
	expect(row.title).toBe("Session 7/26 14:30");
	expect(row.agentKind).toBe("claude-code");
	expect(row.projectId).toBeNull();
	expect(row.createdAt).toBeInstanceOf(Date);
	expect(row.lastActivityAt).toBeInstanceOf(Date);
});

it("getById is owner-scoped", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	expect((await store.getById(row.id, USER_1))?.id).toBe(row.id);
	expect(await store.getById(row.id, USER_2)).toBeNull();
});

it("listActiveByComputer returns active rows newest-activity first", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const a = await store.create(baseInsert({ title: "A" }));
	const b = await store.create(baseInsert({ title: "B" }));
	// Bump A's activity so it should sort ahead of B.
	await store.touchActivity(COMPUTER_1, a.id);
	const list = await store.listActiveByComputer(USER_1, COMPUTER_1);
	expect(list.map((r) => r.id)).toEqual([a.id, b.id]);
});

it("listActiveByComputer excludes ended and other computers", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const active = await store.create(baseInsert());
	const ended = await store.create(baseInsert());
	await store.markEnded(ended.id, USER_1);
	await store.create(baseInsert({ computerId: COMPUTER_2 }));
	const list = await store.listActiveByComputer(USER_1, COMPUTER_1);
	expect(list.map((r) => r.id)).toEqual([active.id]);
});

it("listActiveByComputer filters by projectId when given", async () => {
	await seedGraph();
	const projectId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
	await db.insert(projects).values({
		id: projectId,
		userId: USER_1,
		computerId: COMPUTER_1,
		name: "repo",
		repoFullName: "o/r",
		repoCloneUrl: "https://x",
	});
	const store = createPtySessionStore(db);
	const inProject = await store.create(baseInsert({ projectId }));
	await store.create(baseInsert({ projectId: null }));
	const list = await store.listActiveByComputer(USER_1, COMPUTER_1, projectId);
	expect(list.map((r) => r.id)).toEqual([inProject.id]);
});

it("listActiveByUser spans computers, active only", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const a = await store.create(baseInsert({ computerId: COMPUTER_1 }));
	const b = await store.create(baseInsert({ computerId: COMPUTER_2 }));
	const ended = await store.create(baseInsert());
	await store.markEnded(ended.id, USER_1);
	const ids = (await store.listActiveByUser(USER_1)).map((r) => r.id).sort();
	expect(ids).toEqual([a.id, b.id].sort());
});

it("markEnded is owner-scoped and returns the ended row", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	expect(await store.markEnded(row.id, USER_2)).toBeNull();
	const ended = await store.markEnded(row.id, USER_1);
	expect(ended?.status).toBe("ended");
	expect(ended?.computerId).toBe(COMPUTER_1);
	expect((await store.getById(row.id, USER_1))?.status).toBe("ended");
});

it("touchActivity is computer-scoped and advances last activity", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	const before = row.lastActivityAt.getTime();
	await new Promise((r) => setTimeout(r, 5));
	// Wrong computer: no-op.
	await store.touchActivity(COMPUTER_2, row.id);
	expect((await store.getById(row.id, USER_1))?.lastActivityAt.getTime()).toBe(
		before
	);
	await store.touchActivity(COMPUTER_1, row.id);
	const after = (await store.getById(row.id, USER_1))?.lastActivityAt.getTime();
	expect(after).toBeGreaterThan(before);
});

it("create defaults the agent-session binding to unbound + not-started", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	expect(row.agentSessionId).toBeNull();
	expect(row.agentSessionStarted).toBe(false);
});

it("setAgentSession binds the id and flips started", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	await store.setAgentSession(row.id, "captured-codex-id");
	const bound = await store.getById(row.id, USER_1);
	expect(bound?.agentSessionId).toBe("captured-codex-id");
	expect(bound?.agentSessionStarted).toBe(true);
});

it("markStarted flips started without touching the bound id", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	await store.markStarted(row.id);
	const started = await store.getById(row.id, USER_1);
	expect(started?.agentSessionStarted).toBe(true);
	expect(started?.agentSessionId).toBeNull();
});

it("rename is owner-scoped", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const row = await store.create(baseInsert());
	expect(await store.rename(row.id, USER_2, "Nope")).toBeNull();
	const renamed = await store.rename(row.id, USER_1, "My term");
	expect(renamed?.title).toBe("My term");
});

it("endStaleExcept ends unlisted active rows but spares recent + alive", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const kept = await store.create(baseInsert({ title: "kept" }));
	const stale = await store.create(baseInsert({ title: "stale" }));
	const otherComputer = await store.create(
		baseInsert({ computerId: COMPUTER_2 })
	);
	// Backdate both so neither is protected by the grace window.
	await db
		.update(ptySessions)
		.set({ createdAt: new Date(Date.now() - 60_000) });
	await store.endStaleExcept(COMPUTER_1, [kept.id]);
	expect((await store.getById(kept.id, USER_1))?.status).toBe("active");
	expect((await store.getById(stale.id, USER_1))?.status).toBe("ended");
	// A different computer's session is untouched.
	expect((await store.getById(otherComputer.id, USER_1))?.status).toBe(
		"active"
	);
});

it("endStaleExcept spares sessions created within the grace window", async () => {
	await seedGraph();
	const store = createPtySessionStore(db);
	const fresh = await store.create(baseInsert());
	// Empty alive list would normally end everything on the computer.
	await store.endStaleExcept(COMPUTER_1, []);
	expect((await store.getById(fresh.id, USER_1))?.status).toBe("active");
});
