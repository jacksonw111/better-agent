import { COMPUTER_OFFLINE_AFTER_MS } from "@better-agent/agent/computer-ports";
import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	pairComputer,
	type Rig,
} from "./runs-test-helpers";

// S2-T3: tasks.list / tasks.get / tasks.retry. Retry = a NEW sequential Run
// on the same Task (§16) — allowed only from failed/stopped, with the same
// online-computer gate as Start; the old Run and its real error are kept.

const BACKDATE_MS = 60_000;
const RUNS_AFTER_RETRY = 2;

async function startTask(rig: Rig, name: string) {
	const paired = await pairComputer(rig, ALICE, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
	});
	const created = await rig.userClientFor(ALICE).tasks.create({
		agentKind: "claude-code",
		computerId: paired.computerId,
		description: `${name}: fix it with /tdd`,
		name,
	});
	return { ...paired, ...created };
}

function backdateTask(rig: Rig, taskId: string) {
	const row = rig.task.rows.get(taskId);
	if (row) {
		rig.task.rows.set(taskId, {
			...row,
			createdAt: new Date(row.createdAt.getTime() - BACKDATE_MS),
		});
	}
}

it("list returns the user's tasks newest-first with the latest run status", async () => {
	const rig = buildComputerRig();
	const older = await startTask(rig, "Older task");
	backdateTask(rig, older.taskId);
	const newer = await startTask(rig, "Newer task");
	await rig.run.updateStatus(newer.runId, {
		errorMessage: "runtime exited 1",
		status: "failed",
	});

	const listed = await rig.userClientFor(ALICE).tasks.list();
	expect(listed.map((task) => task.id)).toEqual([newer.taskId, older.taskId]);
	expect(listed[0]?.latestRun).toMatchObject({
		errorMessage: "runtime exited 1",
		id: newer.runId,
		status: "failed",
	});
	expect(listed[1]?.latestRun).toMatchObject({ status: "created" });
	expect(await rig.userClientFor(BOB).tasks.list()).toEqual([]);
});

it("get returns the task, its runs and the computer name; not the credential", async () => {
	const rig = buildComputerRig();
	const { runId, taskId } = await startTask(rig, "Inspect me");

	const got = await rig.userClientFor(ALICE).tasks.get({ taskId });
	expect(got.task.id).toBe(taskId);
	expect(got.task.openingMessage).toContain("Inspect me: fix it with /tdd");
	expect(got.computerName).toBe("John's MacBook");
	expect(got.runs).toHaveLength(1);
	expect(got.runs[0]).toMatchObject({ id: runId, status: "created" });
	// The internal session credential linkage never leaves the server.
	expect(got.runs[0]).not.toHaveProperty("sessionTokenId");

	await expect(
		rig.userClientFor(BOB).tasks.get({ taskId })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("retry after a failed run appends a fresh sequential run", async () => {
	const rig = buildComputerRig();
	const { client, computerId, runId, taskId } = await startTask(rig, "Retry");
	await client().runs.ackLaunch({ runId });
	await rig.run.updateStatus(runId, {
		errorMessage: "git clone failed: repo not found",
		status: "failed",
	});

	const { runId: retryRunId } = await rig
		.userClientFor(ALICE)
		.tasks.retry({ taskId });

	expect(retryRunId).not.toBe(runId);
	const oldRun = rig.run.rows.get(runId);
	expect(oldRun?.status).toBe("failed");
	expect(oldRun?.errorMessage).toBe("git clone failed: repo not found");
	const newRun = rig.run.rows.get(retryRunId);
	expect(newRun?.taskId).toBe(taskId);
	expect(newRun?.computerId).toBe(computerId);
	expect(newRun?.status).toBe("created");
	expect(newRun?.launchKey).toBe(retryRunId);
	expect(newRun?.workspaceKind).toBe("standalone");
	expect(newRun?.sessionTokenId).not.toBe(oldRun?.sessionTokenId);

	// Only the new run is pending — one idempotent delivery, same as Start.
	const { pendingCommands } = await client().computers.heartbeat();
	expect(pendingCommands.map((command) => command.runId)).toEqual([retryRunId]);
});

it("retry is allowed after a stopped run", async () => {
	const rig = buildComputerRig();
	const { runId, taskId } = await startTask(rig, "Stopped");
	await rig.run.updateStatus(runId, { status: "stopped" });

	await expect(
		rig.userClientFor(ALICE).tasks.retry({ taskId })
	).resolves.toMatchObject({ runId: expect.any(String) });
	expect(rig.run.rows.size).toBe(RUNS_AFTER_RETRY);
});

it("retry is rejected while the latest run is not failed or stopped", async () => {
	const rig = buildComputerRig();
	const { runId, taskId } = await startTask(rig, "Still going");
	const client = rig.userClientFor(ALICE);

	await expect(client.tasks.retry({ taskId })).rejects.toMatchObject({
		code: "PRECONDITION_FAILED",
	});
	await rig.run.updateStatus(runId, { status: "running" });
	await expect(client.tasks.retry({ taskId })).rejects.toMatchObject({
		code: "PRECONDITION_FAILED",
	});
	expect(rig.run.rows.size).toBe(1);
});

it("retry needs the computer online and the caller to own the task", async () => {
	const rig = buildComputerRig();
	const { computerId, runId, taskId } = await startTask(rig, "Offline retry");
	await rig.run.updateStatus(runId, { status: "failed" });

	await expect(
		rig.userClientFor(BOB).tasks.retry({ taskId })
	).rejects.toMatchObject({ code: "NOT_FOUND" });

	const row = rig.rows.get(computerId);
	if (row) {
		rig.rows.set(computerId, {
			...row,
			lastSeenAt: new Date(Date.now() - COMPUTER_OFFLINE_AFTER_MS - 1),
		});
	}
	await expect(
		rig.userClientFor(ALICE).tasks.retry({ taskId })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expect(rig.run.rows.size).toBe(1);
});
