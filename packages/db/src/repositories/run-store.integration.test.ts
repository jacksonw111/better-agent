import type {
	RunInsert,
	RunRow,
	RunStore,
} from "@better-agent/agent/task-ports";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { bridgeSessions, bridgeTokens } from "../schema/bridge";
import { computers } from "../schema/computers";
import { runs, tasks } from "../schema/tasks";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createRunStore } from "./run-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedTask(): Promise<{
	computerId: string;
	taskId: string;
	userId: string;
}> {
	const [user] = await db
		.insert(users)
		.values({ email: "alice@x.com" })
		.returning();
	const userId = user?.id ?? "";
	const [computer] = await db
		.insert(computers)
		.values({ userId, publicKeyPem: "pem", name: "John's MacBook" })
		.returning();
	const computerId = computer?.id ?? "";
	const [task] = await db
		.insert(tasks)
		.values({
			userId,
			computerId,
			agentKind: "claude-code",
			name: "Fix login flake",
			description: "Fix the flaky login test",
			openingMessage: "Fix the flaky login test",
		})
		.returning();
	return { computerId, taskId: task?.id ?? "", userId };
}

async function seedBridgeSession(userId: string): Promise<string> {
	const [token] = await db
		.insert(bridgeTokens)
		.values({ userId, tokenHash: `hash-${userId}` })
		.returning();
	const [session] = await db
		.insert(bridgeSessions)
		.values({ userId, tokenId: token?.id ?? "", agentKind: "claude-code" })
		.returning();
	return session?.id ?? "";
}

function runInput(
	taskId: string,
	computerId: string,
	launchKey: string
): RunInsert {
	return {
		agentKind: "claude-code",
		branch: null,
		computerId,
		issueSnapshots: [],
		launchKey,
		taskId,
		workspaceKind: "standalone",
	};
}

it("insert persists a Run as created and getById returns it with issue snapshots", async () => {
	const store = createRunStore(db);
	const { computerId, taskId } = await seedTask();
	const snapshots = [
		{
			body: "Login intermittently 500s.",
			number: 42,
			title: "Login fails",
			url: "https://github.com/acme/app/issues/42",
		},
	];

	const created = await store.insert({
		...runInput(taskId, computerId, "run-1"),
		branch: "task/abc12345",
		issueSnapshots: snapshots,
		workspaceKind: "repository",
	});

	expect(created.id).toBeTruthy();
	expect(created.status).toBe("created");
	expect(created.taskId).toBe(taskId);
	expect(created.computerId).toBe(computerId);
	expect(created.launchKey).toBe("run-1");
	expect(created.workspaceKind).toBe("repository");
	expect(created.branch).toBe("task/abc12345");
	expect(created.issueSnapshots).toEqual(snapshots);
	expect(created.workspacePath).toBeNull();
	expect(created.sessionId).toBeNull();
	expect(created.errorMessage).toBeNull();

	expect(await store.getById(created.id)).toEqual(created);
	expect(
		await store.getById("00000000-0000-4000-8000-000000000000")
	).toBeNull();
});

it("insert rejects a duplicate launchKey", async () => {
	const store = createRunStore(db);
	const { computerId, taskId } = await seedTask();
	await store.insert(runInput(taskId, computerId, "run-1"));

	await expect(
		store.insert(runInput(taskId, computerId, "run-1"))
	).rejects.toThrow();
});

it("getByLaunchKey finds the Run; null for an unknown key", async () => {
	const store = createRunStore(db);
	const { computerId, taskId } = await seedTask();
	const created = await store.insert(runInput(taskId, computerId, "run-1"));

	expect(await store.getByLaunchKey("run-1")).toEqual(created);
	expect(await store.getByLaunchKey("nope")).toBeNull();
});

it("listByTask returns the Task's Runs in chronological order; latestByTask the newest", async () => {
	const store = createRunStore(db);
	const { computerId, taskId } = await seedTask();

	// Explicit createdAt (inserted out of order) proves the sort really is by
	// createdAt — PGlite's now() can collide for fast sequential inserts.
	const seedRunAt = async (launchKey: string, createdAt: Date) => {
		const [row] = await db
			.insert(runs)
			.values({ ...runInput(taskId, computerId, launchKey), createdAt })
			.returning();
		return row?.id ?? "";
	};
	const second = await seedRunAt("run-2", new Date("2026-07-15T12:01:00Z"));
	const third = await seedRunAt("run-3", new Date("2026-07-15T12:02:00Z"));
	const first = await seedRunAt("run-1", new Date("2026-07-15T12:00:00Z"));

	const rows = await store.listByTask(taskId);
	expect(rows.map((row) => row.id)).toEqual([first, second, third]);

	expect((await store.latestByTask(taskId))?.id).toBe(third);
	expect(
		await store.latestByTask("00000000-0000-4000-8000-000000000000")
	).toBeNull();
});

async function mustGetById(store: RunStore, id: string): Promise<RunRow> {
	const row = await store.getById(id);
	if (!row) {
		throw new Error(`Run ${id} not found`);
	}
	return row;
}

it("updateStatus updates only the provided fields", async () => {
	const store = createRunStore(db);
	const { computerId, taskId, userId } = await seedTask();
	const created = await store.insert(runInput(taskId, computerId, "run-1"));
	const sessionId = await seedBridgeSession(userId);

	expect(
		await store.updateStatus(created.id, { status: "preparing_workspace" })
	).toBe(true);
	let row = await mustGetById(store, created.id);
	expect(row.status).toBe("preparing_workspace");
	expect(row.workspacePath).toBeNull();
	expect(row.sessionId).toBeNull();

	await store.updateStatus(created.id, {
		sessionId,
		status: "running",
		workspacePath: "/home/u/.better-agent/tasks/t1",
	});
	row = await mustGetById(store, created.id);
	expect(row.status).toBe("running");
	expect(row.workspacePath).toBe("/home/u/.better-agent/tasks/t1");
	expect(row.sessionId).toBe(sessionId);
	expect(row.errorMessage).toBeNull();

	await store.updateStatus(created.id, {
		errorMessage: "git clone failed: repository not found",
		status: "failed",
	});
	row = await mustGetById(store, created.id);
	expect(row.status).toBe("failed");
	expect(row.errorMessage).toBe("git clone failed: repository not found");
	// Fields omitted from the failed update keep their earlier values.
	expect(row.workspacePath).toBe("/home/u/.better-agent/tasks/t1");
	expect(row.sessionId).toBe(sessionId);
});

async function seedBridgeToken(userId: string, hash: string): Promise<string> {
	const [token] = await db
		.insert(bridgeTokens)
		.values({ userId, tokenHash: hash })
		.returning();
	return token?.id ?? "";
}

it("insert persists sessionTokenId and getById returns it", async () => {
	const store = createRunStore(db);
	const { computerId, taskId, userId } = await seedTask();
	const sessionTokenId = await seedBridgeToken(userId, "hash-session-token");

	const created = await store.insert({
		...runInput(taskId, computerId, "run-1"),
		sessionTokenId,
	});
	expect(created.sessionTokenId).toBe(sessionTokenId);
	expect((await store.getById(created.id))?.sessionTokenId).toBe(
		sessionTokenId
	);

	// Omitted (pre-S2-T3 callers): stays null.
	const bare = await store.insert(runInput(taskId, computerId, "run-2"));
	expect(bare.sessionTokenId).toBeNull();
});

it("listCreatedByComputer returns only that computer's created Runs, oldest first", async () => {
	const store = createRunStore(db);
	const { computerId, taskId, userId } = await seedTask();
	const seedRunAt = async (launchKey: string, createdAt: Date) => {
		const [row] = await db
			.insert(runs)
			.values({ ...runInput(taskId, computerId, launchKey), createdAt })
			.returning();
		return row?.id ?? "";
	};
	const second = await seedRunAt("run-2", new Date("2026-07-15T12:01:00Z"));
	const first = await seedRunAt("run-1", new Date("2026-07-15T12:00:00Z"));
	const acked = await seedRunAt("run-3", new Date("2026-07-15T12:02:00Z"));
	await store.updateStatus(acked, { status: "launching" });
	// Another computer's created Run must never appear in this queue.
	const [other] = await db
		.insert(computers)
		.values({ userId, publicKeyPem: "pem", name: "Other" })
		.returning();
	await store.insert({
		...runInput(taskId, other?.id ?? "", "run-4"),
	});

	const pending = await store.listCreatedByComputer(computerId);
	expect(pending.map((row) => row.id)).toEqual([first, second]);
});

it("getByIdForComputer is scoped to the computer", async () => {
	const store = createRunStore(db);
	const { computerId, taskId, userId } = await seedTask();
	const created = await store.insert(runInput(taskId, computerId, "run-1"));
	const [other] = await db
		.insert(computers)
		.values({ userId, publicKeyPem: "pem", name: "Other" })
		.returning();

	expect((await store.getByIdForComputer(created.id, computerId))?.id).toBe(
		created.id
	);
	expect(
		await store.getByIdForComputer(created.id, other?.id ?? "")
	).toBeNull();
});

it("updateStatus returns false for an unknown Run", async () => {
	const store = createRunStore(db);
	await seedTask();

	expect(
		await store.updateStatus("00000000-0000-4000-8000-000000000000", {
			status: "running",
		})
	).toBe(false);
});
