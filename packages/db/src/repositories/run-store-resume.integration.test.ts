import type { RunInsert } from "@better-agent/agent/task-ports";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { computers } from "../schema/computers";
import { tasks } from "../schema/tasks";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createRunStore } from "./run-store";

// P1 (session resume): the runs.resume_agent_session_id column — the previous
// run's runtime conversation id captured at tasks.resume so the Launch payload
// can drive a native resume. Split from run-store.integration.test.ts to keep
// that file under the per-file line cap.

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedTask(): Promise<{ computerId: string; taskId: string }> {
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
			name: "Chat",
			description: "",
			openingMessage: "",
		})
		.returning();
	return { computerId, taskId: task?.id ?? "" };
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

it("insert persists resumeAgentSessionId; omitted stays null", async () => {
	const store = createRunStore(db);
	const { computerId, taskId } = await seedTask();

	const resumed = await store.insert({
		...runInput(taskId, computerId, "run-1"),
		resumeAgentSessionId: "claude-abc",
	});
	expect(resumed.resumeAgentSessionId).toBe("claude-abc");
	expect((await store.getById(resumed.id))?.resumeAgentSessionId).toBe(
		"claude-abc"
	);

	// Cold starts (create/retry) never set it: stays null.
	const bare = await store.insert(runInput(taskId, computerId, "run-2"));
	expect(bare.resumeAgentSessionId).toBeNull();
});
