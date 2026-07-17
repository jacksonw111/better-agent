import { COMPUTER_OFFLINE_AFTER_MS } from "@better-agent/agent/computer-ports";
import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	pairComputer,
	type Rig,
} from "./runs-test-helpers";

// S2-T3: atomic Task Start (master spec §8.5 + §19.2). tasks.create validates
// name/description, computer ownership + connectedness and runtime inventory
// BEFORE writing anything, then saves task + opening message + first Run and
// enqueues exactly one idempotent Launch. No lifecycle chat is ever written.

const DESCRIPTION = "Fix the flaky login test with /tdd";
const TASK_NAME = "Login flake";

function createInput(computerId: string) {
	return {
		agentKind: "claude-code" as const,
		computerId,
		description: DESCRIPTION,
		name: TASK_NAME,
	};
}

async function pairClaudeComputer(rig: Rig, user: typeof ALICE = ALICE) {
	return await pairComputer(rig, user, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
	});
}

function expectNoRowsLeft(rig: Rig) {
	expect(rig.task.rows.size).toBe(0);
	expect(rig.run.rows.size).toBe(0);
}

/** Non-null row lookup keeping assertion bodies free of `?.` branches. */
function mustGet<T>(map: Map<string, T>, id: string): T {
	const row = map.get(id);
	if (!row) {
		throw new Error(`expected row ${id} to exist`);
	}
	return row;
}

it("create saves the task, the opening message and the first run (§8.5)", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);

	const { runId, taskId } = await rig
		.userClientFor(ALICE)
		.tasks.create(createInput(computerId));

	const task = mustGet(rig.task.rows, taskId);
	expect(task.status).toBe("active");
	expect(task.name).toBe(TASK_NAME);
	// Description is stored verbatim and appears verbatim in the opening
	// message, /skill reference included; the Task Name never does.
	expect(task.description).toBe(DESCRIPTION);
	expect(task.openingMessage).toContain(DESCRIPTION);
	expect(task.openingMessage).not.toContain(TASK_NAME);
	expect(task.openingMessage).not.toContain("GitHub context");
	expect(task.openingMessage).toContain("- Computer: John's MacBook");
	expect(task.openingMessage).toContain("- Workspace: managed task directory");

	const run = mustGet(rig.run.rows, runId);
	expect(run.taskId).toBe(taskId);
	expect(run.status).toBe("created");
	expect(run.launchKey).toBe(runId);
	expect(run.workspaceKind).toBe("standalone");
	expect(run.issueSnapshots).toEqual([]);
	expect(run.sessionTokenId).toBeTruthy();
});

it("create yields exactly one idempotent launch delivery, gone after ack", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaudeComputer(rig);

	const { runId } = await rig
		.userClientFor(ALICE)
		.tasks.create(createInput(computerId));

	const first = (await client().computers.heartbeat()).pendingCommands;
	const second = (await client().computers.heartbeat()).pendingCommands;
	expect(first).toHaveLength(1);
	expect(first[0]?.runId).toBe(runId);
	expect(first[0]?.kind).toBe("launch");
	expect(second).toEqual(first);

	await client().runs.ackLaunch({ runId });
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);
});

it("the whole start flow writes no lifecycle chat messages", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaudeComputer(rig);

	const { runId } = await rig
		.userClientFor(ALICE)
		.tasks.create(createInput(computerId));
	await client().computers.heartbeat();
	await client().runs.ackLaunch({ runId });

	expect(rig.bridgeMessages.size).toBe(0);
});

it("rejects starting on another user's computer and leaves no rows", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);

	await expect(
		rig.userClientFor(BOB).tasks.create(createInput(computerId))
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expectNoRowsLeft(rig);
});

it("rejects an offline computer without queueing anything", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	const row = rig.rows.get(computerId);
	if (row) {
		rig.rows.set(computerId, {
			...row,
			lastSeenAt: new Date(Date.now() - COMPUTER_OFFLINE_AFTER_MS - 1),
		});
	}

	await expect(
		rig.userClientFor(ALICE).tasks.create(createInput(computerId))
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expectNoRowsLeft(rig);
});

it("rejects an agent runtime missing from the computer's inventory", async () => {
	const rig = buildComputerRig();
	// Default registration: empty runtimeInventory — claude-code not present.
	const { computerId } = await pairComputer(rig, ALICE);

	await expect(
		rig.userClientFor(ALICE).tasks.create(createInput(computerId))
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expectNoRowsLeft(rig);
});

it("allows start with gh (and git) missing — tool auth is never a gate", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
		toolInventory: [
			{ installed: false, name: "git" },
			{ installed: false, name: "gh" },
		],
	});

	await expect(
		rig.userClientFor(ALICE).tasks.create(createInput(computerId))
	).resolves.toMatchObject({ runId: expect.any(String) });
});

it("rejects a blank provided name and an oversized name", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	const client = rig.userClientFor(ALICE);
	const input = createInput(computerId);
	const nameMax = 120;

	// P1: a blank description is now a valid chat session (tasks-session
	// .test.ts) — but a name, when PROVIDED, must still carry visible text.
	await expect(
		client.tasks.create({ ...input, name: "   " })
	).rejects.toThrow();
	await expect(
		client.tasks.create({ ...input, name: "x".repeat(nameMax + 1) })
	).rejects.toThrow();
	expectNoRowsLeft(rig);
});
