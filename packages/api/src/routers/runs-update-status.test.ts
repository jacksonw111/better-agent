import type { RunStatus } from "@better-agent/agent/task-ports";
import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer, seedRun } from "./runs-test-helpers";

// S2-T3: runs.updateStatus — the client's progress reports (§11.2). Only
// forward transitions along launching → preparing_workspace →
// starting_runtime → running → waiting_for_user/completed/stopped/failed are
// applied; failed/stopped/completed are terminal. An illegal transition is
// { ok: false }, never an error, and never touches the row.

it("advances a run through the legal lifecycle chain", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);
	await client().runs.ackLaunch({ runId: run.id });

	await expect(
		client().runs.updateStatus({
			runId: run.id,
			status: "preparing_workspace",
			workspacePath: "/home/john/.better-agent/tasks/t1",
		})
	).resolves.toEqual({ ok: true });
	expect(rig.run.rows.get(run.id)?.workspacePath).toBe(
		"/home/john/.better-agent/tasks/t1"
	);

	const chain = ["starting_runtime", "running", "completed"] as const;
	for (const status of chain) {
		await expect(
			client().runs.updateStatus({ runId: run.id, status })
		).resolves.toEqual({ ok: true });
		expect(rig.run.rows.get(run.id)?.status).toBe(status);
	}
});

it("running can park at waiting_for_user", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);
	await rig.run.updateStatus(run.id, { status: "running" });

	await expect(
		client().runs.updateStatus({ runId: run.id, status: "waiting_for_user" })
	).resolves.toEqual({ ok: true });
});

it("rejects a backwards transition with ok:false and leaves the row alone", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);
	await rig.run.updateStatus(run.id, { status: "running" });

	await expect(
		client().runs.updateStatus({
			runId: run.id,
			status: "preparing_workspace",
			workspacePath: "/tmp/should-not-land",
		})
	).resolves.toEqual({ ok: false });
	expect(rig.run.rows.get(run.id)?.status).toBe("running");
	expect(rig.run.rows.get(run.id)?.workspacePath).toBeNull();
});

it("terminal statuses reject every further transition", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const terminals: RunStatus[] = ["failed", "stopped", "completed"];
	for (const terminal of terminals) {
		const { run } = await seedRun(rig, computerId);
		await rig.run.updateStatus(run.id, { status: terminal });
		await expect(
			client().runs.updateStatus({ runId: run.id, status: "running" })
		).resolves.toEqual({ ok: false });
		expect(rig.run.rows.get(run.id)?.status).toBe(terminal);
	}
});

it("failure records the real error message", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);
	await rig.run.updateStatus(run.id, { status: "preparing_workspace" });

	await expect(
		client().runs.updateStatus({
			errorMessage: "fatal: repository 'acme/app' not found",
			runId: run.id,
			status: "failed",
		})
	).resolves.toEqual({ ok: true });
	expect(rig.run.rows.get(run.id)?.errorMessage).toBe(
		"fatal: repository 'acme/app' not found"
	);
});

it("a fields-only update keeps the current status", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);
	await rig.run.updateStatus(run.id, { status: "running" });

	await expect(
		client().runs.updateStatus({
			runId: run.id,
			workspacePath: "/home/john/.better-agent/tasks/t1",
		})
	).resolves.toEqual({ ok: true });
	expect(rig.run.rows.get(run.id)?.status).toBe("running");
});

it("another computer cannot update someone else's run", async () => {
	const rig = buildComputerRig();
	const alice = await pairComputer(rig, ALICE);
	const bob = await pairComputer(rig, BOB);
	const { run } = await seedRun(rig, alice.computerId);

	await expect(
		bob.client().runs.updateStatus({ runId: run.id, status: "running" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(rig.run.rows.get(run.id)?.status).toBe("created");
});
