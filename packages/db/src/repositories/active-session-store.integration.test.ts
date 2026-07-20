import type { RunStatus } from "@better-agent/agent/task-ports";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { bridgeSessions, bridgeTokens } from "../schema/bridge";
import { computers } from "../schema/computers";
import { projects } from "../schema/projects";
import { runs, tasks } from "../schema/tasks";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createActiveSessionStore } from "./active-session-store";

// The multi-session model's read path: every Task of a user whose LATEST Run
// is still non-terminal, joined to the computer/project/session context the
// global "what's still running" view needs — one query, no N+1.

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedUser(email: string): Promise<string> {
	const [user] = await db.insert(users).values({ email }).returning();
	return user?.id ?? "";
}

async function seedComputer(userId: string, name: string): Promise<string> {
	const [computer] = await db
		.insert(computers)
		.values({ userId, publicKeyPem: "pem", name })
		.returning();
	return computer?.id ?? "";
}

async function seedProject(
	userId: string,
	computerId: string,
	name: string
): Promise<string> {
	const [project] = await db
		.insert(projects)
		.values({
			userId,
			computerId,
			name,
			repoFullName: `octocat/${name}`,
			repoCloneUrl: `https://github.com/octocat/${name}.git`,
			status: "ready",
		})
		.returning();
	return project?.id ?? "";
}

async function seedTask(input: {
	computerId: string;
	name: string;
	projectId?: string;
	userId: string;
}): Promise<string> {
	const [task] = await db
		.insert(tasks)
		.values({
			userId: input.userId,
			computerId: input.computerId,
			agentKind: "claude-code",
			name: input.name,
			description: "",
			openingMessage: "",
			projectId: input.projectId ?? null,
		})
		.returning();
	return task?.id ?? "";
}

async function seedRun(input: {
	computerId: string;
	createdAt?: Date;
	sessionId?: string;
	status: RunStatus;
	taskId: string;
}): Promise<string> {
	const [run] = await db
		.insert(runs)
		.values({
			taskId: input.taskId,
			computerId: input.computerId,
			agentKind: "claude-code",
			status: input.status,
			launchKey: crypto.randomUUID(),
			workspaceKind: "standalone",
			sessionId: input.sessionId ?? null,
			...(input.createdAt ? { createdAt: input.createdAt } : {}),
		})
		.returning();
	return run?.id ?? "";
}

async function seedSession(userId: string, lastSeenAt?: Date): Promise<string> {
	const [token] = await db
		.insert(bridgeTokens)
		.values({ userId, tokenHash: `hash-${crypto.randomUUID()}` })
		.returning();
	const [session] = await db
		.insert(bridgeSessions)
		.values({
			userId,
			tokenId: token?.id ?? "",
			agentKind: "claude-code",
			...(lastSeenAt ? { lastSeenAt } : {}),
		})
		.returning();
	return session?.id ?? "";
}

it("returns the task's latest run with computer, project and session joined", async () => {
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId, "John's MacBook");
	const projectId = await seedProject(userId, computerId, "better-agent");
	const taskId = await seedTask({
		computerId,
		name: "Refactor auth",
		projectId,
		userId,
	});
	const lastSeenAt = new Date("2026-07-15T10:00:00.000Z");
	const sessionId = await seedSession(userId, lastSeenAt);
	const runId = await seedRun({
		computerId,
		sessionId,
		status: "running",
		taskId,
	});

	const rows = await createActiveSessionStore(db).listActiveByUser(userId);

	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		agentKind: "claude-code",
		computerId,
		computerName: "John's MacBook",
		projectId,
		projectName: "better-agent",
		runId,
		runStatus: "running",
		sessionId,
		sessionStatus: "active",
		taskId,
		taskName: "Refactor auth",
	});
	expect(rows[0]?.sessionLastSeenAt?.getTime()).toBe(lastSeenAt.getTime());
	expect(rows[0]?.computerLastSeenAt).toBeInstanceOf(Date);
});

it("includes every non-terminal status", async () => {
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId, "Mac");
	const active: RunStatus[] = [
		"created",
		"launching",
		"preparing_workspace",
		"starting_runtime",
		"running",
		"waiting_for_user",
	];
	for (const status of active) {
		const taskId = await seedTask({ computerId, name: status, userId });
		await seedRun({ computerId, status, taskId });
	}

	const rows = await createActiveSessionStore(db).listActiveByUser(userId);

	expect(rows.map((row) => row.runStatus).sort()).toEqual([...active].sort());
});

it("excludes tasks whose latest run is terminal", async () => {
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId, "Mac");
	for (const status of ["completed", "failed", "stopped"] as RunStatus[]) {
		const taskId = await seedTask({ computerId, name: status, userId });
		await seedRun({ computerId, status, taskId });
	}

	const rows = await createActiveSessionStore(db).listActiveByUser(userId);

	expect(rows).toEqual([]);
});

it("judges by the LATEST run only — an old stuck run under a settled task is history", async () => {
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId, "Mac");
	const taskId = await seedTask({ computerId, name: "Retried", userId });
	await seedRun({
		computerId,
		createdAt: new Date("2026-07-01T00:00:00.000Z"),
		status: "running",
		taskId,
	});
	await seedRun({
		computerId,
		createdAt: new Date("2026-07-02T00:00:00.000Z"),
		status: "completed",
		taskId,
	});

	const rows = await createActiveSessionStore(db).listActiveByUser(userId);

	expect(rows).toEqual([]);
});

it("surfaces the newest run when an older one is the terminal sibling", async () => {
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId, "Mac");
	const taskId = await seedTask({ computerId, name: "Resumed", userId });
	await seedRun({
		computerId,
		createdAt: new Date("2026-07-01T00:00:00.000Z"),
		status: "stopped",
		taskId,
	});
	const newest = await seedRun({
		computerId,
		createdAt: new Date("2026-07-02T00:00:00.000Z"),
		status: "running",
		taskId,
	});

	const rows = await createActiveSessionStore(db).listActiveByUser(userId);

	expect(rows.map((row) => row.runId)).toEqual([newest]);
});

it("returns a run with no bound session, and a task with no project", async () => {
	const userId = await seedUser("alice@x.com");
	const computerId = await seedComputer(userId, "Mac");
	const taskId = await seedTask({ computerId, name: "Chat", userId });
	await seedRun({ computerId, status: "created", taskId });

	const rows = await createActiveSessionStore(db).listActiveByUser(userId);

	expect(rows[0]).toMatchObject({
		projectId: null,
		projectName: null,
		sessionId: null,
		sessionLastSeenAt: null,
		sessionStatus: null,
	});
});

it("never leaks another user's active sessions", async () => {
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const bobComputer = await seedComputer(bob, "Bob's Mac");
	const bobTask = await seedTask({
		computerId: bobComputer,
		name: "Bob's work",
		userId: bob,
	});
	await seedRun({
		computerId: bobComputer,
		status: "running",
		taskId: bobTask,
	});

	expect(await createActiveSessionStore(db).listActiveByUser(alice)).toEqual(
		[]
	);
	expect(await createActiveSessionStore(db).listActiveByUser(bob)).toHaveLength(
		1
	);
});

it("spans every computer and project the user owns", async () => {
	const userId = await seedUser("alice@x.com");
	const mac = await seedComputer(userId, "Mac");
	const linux = await seedComputer(userId, "Linux box");
	const macTask = await seedTask({ computerId: mac, name: "A", userId });
	const linuxTask = await seedTask({ computerId: linux, name: "B", userId });
	await seedRun({ computerId: mac, status: "running", taskId: macTask });
	await seedRun({
		computerId: linux,
		status: "waiting_for_user",
		taskId: linuxTask,
	});

	const rows = await createActiveSessionStore(db).listActiveByUser(userId);

	expect(rows.map((row) => row.computerName).sort()).toEqual([
		"Linux box",
		"Mac",
	]);
});
