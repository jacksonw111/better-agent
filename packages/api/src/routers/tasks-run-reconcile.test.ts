import { COMPUTER_OFFLINE_AFTER_MS } from "@better-agent/agent/computer-ports";
import { expect, it } from "vitest";
import { ALICE, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	pairComputer,
	type Rig,
} from "./runs-test-helpers";
import { RUN_STALE_OFFLINE_GRACE_MS } from "./tasks-run-status";

// Run-status reconcile bugfix: tasks.list / tasks.get correct a stale
// non-terminal run status on read. When the client process was killed or the
// machine dropped off the network, nobody ever reports `stopped`, so the
// server presumes it once (a) the computer has been heartbeat-silent past
// RUN_STALE_OFFLINE_GRACE_MS or (b) the bound bridge session is over — and
// PERSISTS the correction (reconcile-on-read, single source of truth).

const A_SECOND = 1000;

/** Pairs a claude computer, starts a session task and drives its run to
 * `running` through the real computer-plane routes (ack + status report). */
async function startRunningRun(rig: Rig) {
	const { client, computerId } = await pairComputer(rig, ALICE, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
	});
	const { runId, taskId } = await rig.userClientFor(ALICE).tasks.create({
		agentKind: "claude-code",
		computerId,
		description: "",
		name: "Chat",
	});
	await client().runs.ackLaunch({ runId });
	await client().runs.updateStatus({ runId, status: "running" });
	return { client, computerId, runId, taskId };
}

/** Rewinds the computer's lastSeenAt so it has been silent for `agoMs`. */
function setLastSeen(rig: Rig, computerId: string, agoMs: number) {
	const row = rig.rows.get(computerId);
	if (row) {
		rig.rows.set(computerId, {
			...row,
			lastSeenAt: new Date(Date.now() - agoMs),
		});
	}
}

/** Binds a bridge session to the run, as startSession(runId) would. */
async function bindSession(rig: Rig, runId: string) {
	const session = await rig.bridgeSession.create({
		agentKind: "claude-code",
		runId,
		tokenId: "tok-reconcile",
		userId: ALICE.id,
	});
	await rig.run.updateStatus(runId, { sessionId: session.id });
	return session;
}

it("list reconciles a running run on a long-offline computer to stopped and persists it", async () => {
	const rig = buildComputerRig();
	const { computerId, runId } = await startRunningRun(rig);
	setLastSeen(rig, computerId, RUN_STALE_OFFLINE_GRACE_MS + A_SECOND);

	const tasks = await rig.userClientFor(ALICE).tasks.list();

	expect(tasks[0]?.latestRun?.status).toBe("stopped");
	// Reconcile-on-read writes the correction back — not a response-only fix.
	expect(rig.run.rows.get(runId)?.status).toBe("stopped");
});

it("get reconciles the same way and persists the correction", async () => {
	const rig = buildComputerRig();
	const { computerId, runId, taskId } = await startRunningRun(rig);
	setLastSeen(rig, computerId, RUN_STALE_OFFLINE_GRACE_MS + A_SECOND);

	const { runs } = await rig.userClientFor(ALICE).tasks.get({ taskId });

	expect(runs[0]?.status).toBe("stopped");
	expect(rig.run.rows.get(runId)?.status).toBe("stopped");
});

it("a running run whose bound session already ended is reconciled to stopped", async () => {
	const rig = buildComputerRig();
	const { runId } = await startRunningRun(rig);
	const session = await bindSession(rig, runId);
	await rig.bridgeSession.end(session.id, ALICE.id);

	const tasks = await rig.userClientFor(ALICE).tasks.list();

	expect(tasks[0]?.latestRun?.status).toBe("stopped");
	expect(rig.run.rows.get(runId)?.status).toBe("stopped");
});

it("a dangling session binding (hard-deleted row) also counts as over", async () => {
	const rig = buildComputerRig();
	const { runId } = await startRunningRun(rig);
	const session = await bindSession(rig, runId);
	await rig.bridgeSession.deleteHard(session.id, ALICE.id);

	const tasks = await rig.userClientFor(ALICE).tasks.list();

	expect(tasks[0]?.latestRun?.status).toBe("stopped");
	expect(rig.run.rows.get(runId)?.status).toBe("stopped");
});

it("a healthy running run — online computer, active session — is untouched", async () => {
	const rig = buildComputerRig();
	const { runId, taskId } = await startRunningRun(rig);
	await bindSession(rig, runId);
	const alice = rig.userClientFor(ALICE);

	expect((await alice.tasks.list())[0]?.latestRun?.status).toBe("running");
	expect((await alice.tasks.get({ taskId })).runs[0]?.status).toBe("running");
	expect(rig.run.rows.get(runId)?.status).toBe("running");
});

it("an offline blip shorter than the grace window never flips a run", async () => {
	const rig = buildComputerRig();
	const { computerId, runId } = await startRunningRun(rig);
	// Past the UI's offline badge threshold, but inside the reconcile grace.
	setLastSeen(rig, computerId, COMPUTER_OFFLINE_AFTER_MS + A_SECOND);

	const tasks = await rig.userClientFor(ALICE).tasks.list();

	expect(tasks[0]?.latestRun?.status).toBe("running");
	expect(rig.run.rows.get(runId)?.status).toBe("running");
});

it("terminal statuses are never rewritten, even offline with an ended session", async () => {
	const rig = buildComputerRig();
	const { client, computerId, runId, taskId } = await startRunningRun(rig);
	const session = await bindSession(rig, runId);
	await client().runs.updateStatus({ runId, status: "completed" });
	await rig.bridgeSession.end(session.id, ALICE.id);
	setLastSeen(rig, computerId, RUN_STALE_OFFLINE_GRACE_MS + A_SECOND);
	const alice = rig.userClientFor(ALICE);

	expect((await alice.tasks.list())[0]?.latestRun?.status).toBe("completed");
	expect((await alice.tasks.get({ taskId })).runs[0]?.status).toBe("completed");
	expect(rig.run.rows.get(runId)?.status).toBe("completed");
});
