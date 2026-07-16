import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer, seedRun } from "./runs-test-helpers";

// S2-T2: idempotent launch delivery (master spec §15.3). The queue IS the
// state: heartbeat pendingCommands = the computer's still-`created` Runs
// rendered as launch payloads; runs.ackLaunch flips a Run to `launching`,
// after which no reconnect or heartbeat can deliver it again.

it("heartbeat delivers a full standalone launch payload for a created run", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { credential, run, task } = await seedRun(rig, computerId);

	const { pendingCommands } = await client().computers.heartbeat();
	expect(pendingCommands).toEqual([
		{
			kind: "launch",
			taskId: task.id,
			runId: run.id,
			agentKind: "claude-code",
			workspace: { kind: "standalone" },
			description: "Fix the flaky login test with /tdd",
			issueSnapshots: [],
			sessionCredential: credential.token,
		},
	]);
});

it("heartbeat delivers the repository workspace form for a repository run", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	await seedRun(rig, computerId, {
		repositoryFullName: "acme/app",
		repositoryUrl: "https://github.com/acme/app",
	});

	const { pendingCommands } = await client().computers.heartbeat();
	expect(pendingCommands[0]?.workspace).toEqual({
		kind: "repository",
		fullName: "acme/app",
		cloneUrl: "https://github.com/acme/app.git",
		defaultBranch: "main",
	});
});

it("ackLaunch flips created to launching and stops all further delivery", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);

	// Redelivery before the ack: the same run every time (idempotent queue).
	expect((await client().computers.heartbeat()).pendingCommands).toHaveLength(
		1
	);
	expect((await client().computers.heartbeat()).pendingCommands).toHaveLength(
		1
	);

	await expect(client().runs.ackLaunch({ runId: run.id })).resolves.toEqual({
		ok: true,
	});
	expect(rig.run.rows.get(run.id)?.status).toBe("launching");

	// After the ack: never deliverable again, however often the client asks.
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);
});

it("a duplicate ack is idempotent: ok:false, status untouched", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);

	await client().runs.ackLaunch({ runId: run.id });
	await expect(client().runs.ackLaunch({ runId: run.id })).resolves.toEqual({
		ok: false,
	});
	expect(rig.run.rows.get(run.id)?.status).toBe("launching");
});

it("acking past created (e.g. an already-running run) returns ok:false", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { run } = await seedRun(rig, computerId);
	await rig.run.updateStatus(run.id, { status: "running" });

	await expect(client().runs.ackLaunch({ runId: run.id })).resolves.toEqual({
		ok: false,
	});
	expect(rig.run.rows.get(run.id)?.status).toBe("running");
});

it("another computer cannot ack or receive someone else's run", async () => {
	const rig = buildComputerRig();
	const alice = await pairComputer(rig, ALICE);
	const bob = await pairComputer(rig, BOB);
	const { run } = await seedRun(rig, alice.computerId);

	await expect(
		bob.client().runs.ackLaunch({ runId: run.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(rig.run.rows.get(run.id)?.status).toBe("created");
	expect((await bob.client().computers.heartbeat()).pendingCommands).toEqual(
		[]
	);
});

it("acking an unknown run is NOT_FOUND", async () => {
	const rig = buildComputerRig();
	const { client } = await pairComputer(rig, ALICE);
	await expect(
		client().runs.ackLaunch({ runId: crypto.randomUUID() })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
