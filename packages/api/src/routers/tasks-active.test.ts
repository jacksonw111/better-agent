import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	pairComputer,
	type Rig,
} from "./runs-test-helpers";
import { RUN_STALE_OFFLINE_GRACE_MS } from "./tasks-run-status";

// tasks.listActive — the multi-session model's global view. A session keeps
// running when the user navigates away, so this is the ONLY way to find work
// that is still going or is blocked waiting on the user, across every computer
// and project.

const A_SECOND = 1000;

/** Pairs a computer, starts a session and drives its run to `running`
 * through the real computer-plane routes, then binds a live bridge session
 * (what the CLI's startSession does) so the run reads as genuinely alive. */
async function startLiveSession(
	rig: Rig,
	options: { name?: string; user?: typeof ALICE } = {}
) {
	const user = options.user ?? ALICE;
	const { client, computerId } = await pairComputer(rig, user, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
	});
	const { runId, taskId } = await rig.userClientFor(user).tasks.create({
		agentKind: "claude-code",
		computerId,
		description: "",
		name: options.name ?? "Chat",
	});
	await client().runs.ackLaunch({ runId });
	await client().runs.updateStatus({ runId, status: "running" });
	const session = await rig.bridgeSession.create({
		agentKind: "claude-code",
		runId,
		tokenId: `tok-${runId}`,
		userId: user.id,
	});
	await rig.run.updateStatus(runId, { sessionId: session.id });
	return { client, computerId, runId, session, taskId };
}

function setLastSeen(rig: Rig, computerId: string, agoMs: number) {
	const row = rig.rows.get(computerId);
	if (row) {
		rig.rows.set(computerId, {
			...row,
			lastSeenAt: new Date(Date.now() - agoMs),
		});
	}
}

it("lists a running session with its computer, agent and run", async () => {
	const rig = buildComputerRig();
	const { computerId, runId, session, taskId } = await startLiveSession(rig, {
		name: "Refactor auth",
	});

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions).toHaveLength(1);
	expect(sessions[0]).toMatchObject({
		agentKind: "claude-code",
		computerId,
		computerName: "John's MacBook",
		name: "Refactor auth",
		needsAttention: false,
		projectId: null,
		projectName: null,
		runId,
		status: "running",
		taskId,
	});
	expect(sessions[0]?.lastActivityAt).toBe(session.lastSeenAt.toISOString());
});

it("keeps listing a session after the web navigates away — only endSession settles it", async () => {
	const rig = buildComputerRig();
	const { runId } = await startLiveSession(rig);
	const alice = rig.userClientFor(ALICE);

	// Whatever the browser does — closing the tab, dropping the SSE stream —
	// no server-side call is involved, so the next poll must be unchanged.
	expect((await alice.tasks.listActive()).sessions).toHaveLength(1);
	expect((await alice.tasks.listActive()).sessions[0]?.status).toBe("running");
	expect(rig.run.rows.get(runId)?.status).toBe("running");
});

it("drops the session once the user explicitly ends it", async () => {
	const rig = buildComputerRig();
	const { session } = await startLiveSession(rig);
	const alice = rig.userClientFor(ALICE);

	await alice.bridge.endSession({ sessionId: session.id });

	expect((await alice.tasks.listActive()).sessions).toEqual([]);
});

it("excludes a session whose computer went silent past the stale grace window", async () => {
	const rig = buildComputerRig();
	const { computerId, runId } = await startLiveSession(rig);
	setLastSeen(rig, computerId, RUN_STALE_OFFLINE_GRACE_MS + A_SECOND);

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions).toEqual([]);
	// Reconcile-on-read persists the correction, same as tasks.list/get.
	expect(rig.run.rows.get(runId)?.status).toBe("stopped");
});

it("excludes a session whose bound bridge session already ended", async () => {
	const rig = buildComputerRig();
	const { runId, session } = await startLiveSession(rig);
	await rig.bridgeSession.end(session.id, ALICE.id);

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions).toEqual([]);
	expect(rig.run.rows.get(runId)?.status).toBe("stopped");
});

it("excludes a terminal run", async () => {
	const rig = buildComputerRig();
	const { client, runId } = await startLiveSession(rig);
	await client().runs.updateStatus({ runId, status: "completed" });

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions).toEqual([]);
});

it("flags waiting_for_user as needing attention", async () => {
	const rig = buildComputerRig();
	const { client, runId } = await startLiveSession(rig);
	await client().runs.updateStatus({ runId, status: "waiting_for_user" });

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions[0]).toMatchObject({
		needsAttention: true,
		status: "waiting_for_user",
	});
});

it("flags an unanswered approval as needing attention", async () => {
	const rig = buildComputerRig();
	const { session } = await startLiveSession(rig);
	await rig.relayStore.append(session.id, "events", {
		kind: "approval",
		requestId: "req-1",
	});

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions[0]?.needsAttention).toBe(true);
});

it("clears attention once the approval is answered", async () => {
	const rig = buildComputerRig();
	const { session } = await startLiveSession(rig);
	await rig.relayStore.append(session.id, "events", {
		kind: "approval",
		requestId: "req-1",
	});
	await rig.relayStore.append(session.id, "commands", {
		optionId: "allow",
		requestId: "req-1",
		type: "approval",
	});

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions[0]?.needsAttention).toBe(false);
});

it("does not flag a session that is merely working", async () => {
	const rig = buildComputerRig();
	const { session } = await startLiveSession(rig);
	await rig.relayStore.append(session.id, "events", {
		kind: "message",
		role: "user",
	});

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions[0]?.needsAttention).toBe(false);
});

it("sorts by last activity, newest first", async () => {
	const rig = buildComputerRig();
	const older = await startLiveSession(rig, { name: "Older" });
	const newer = await startLiveSession(rig, { name: "Newer" });
	rig.bridgeSessionRows.set(older.session.id, {
		...(rig.bridgeSessionRows.get(older.session.id) ?? older.session),
		lastSeenAt: new Date("2026-07-15T09:00:00.000Z"),
	});
	rig.bridgeSessionRows.set(newer.session.id, {
		...(rig.bridgeSessionRows.get(newer.session.id) ?? newer.session),
		lastSeenAt: new Date("2026-07-15T11:00:00.000Z"),
	});

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions.map((entry) => entry.name)).toEqual(["Newer", "Older"]);
});

it("runs many concurrent sessions side by side", async () => {
	const rig = buildComputerRig();
	await startLiveSession(rig, { name: "A" });
	await startLiveSession(rig, { name: "B" });
	await startLiveSession(rig, { name: "C" });

	const { sessions } = await rig.userClientFor(ALICE).tasks.listActive();

	expect(sessions.map((entry) => entry.name).sort()).toEqual(["A", "B", "C"]);
});

it("never returns another user's sessions", async () => {
	const rig = buildComputerRig();
	await startLiveSession(rig, { user: BOB });

	expect((await rig.userClientFor(ALICE).tasks.listActive()).sessions).toEqual(
		[]
	);
	expect(
		(await rig.userClientFor(BOB).tasks.listActive()).sessions
	).toHaveLength(1);
});
