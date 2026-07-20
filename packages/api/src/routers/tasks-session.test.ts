import { COMPUTER_OFFLINE_AFTER_MS } from "@better-agent/agent/computer-ports";
import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	pairComputer,
	type Rig,
} from "./runs-test-helpers";

// P1: session-style Tasks. The UI treats a Task as a chat session, so
// tasks.create accepts an empty description (pure chat, empty opening
// message) and an omitted name (server-generated), tasks.resume appends a
// new Run that continues the SAME runtime conversation via the previous
// run's reported agentSessionId, and tasks.list filters by computer/runtime
// for the agent-centric session lists.

type Paired = Awaited<ReturnType<typeof pairComputer>>;

/** The server-generated fallback name shape: "Session 7/17 14:05". */
const AUTO_SESSION_NAME = /^Session \d{1,2}\/\d{1,2} \d{2}:\d{2}$/;
const STILL_RUNNING = /still running/i;

async function pairClaude(rig: Rig) {
	return await pairComputer(rig, ALICE, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
	});
}

/** Starts a chat-style session Task (empty description) as ALICE. */
async function createChatSession(rig: Rig, computerId: string, name?: string) {
	return await rig.userClientFor(ALICE).tasks.create({
		agentKind: "claude-code",
		computerId,
		description: "",
		name,
	});
}

/** Drives the run out of the launch queue and to a terminal state, bound to
 * a bridge session that reported `agentSessionId` (null = never reported). */
async function finishRun(
	rig: Rig,
	client: Paired["client"],
	runId: string,
	agentSessionId: string | null
) {
	await client().runs.ackLaunch({ runId });
	const session = await rig.bridgeSession.create({
		agentKind: "claude-code",
		runId,
		tokenId: "tok-session",
		userId: ALICE.id,
	});
	if (agentSessionId) {
		await rig.bridgeSession.setAgentSessionId(session.id, agentSessionId);
	}
	await rig.run.updateStatus(runId, {
		sessionId: session.id,
		status: "completed",
	});
	return session;
}

it("create accepts an empty description: stored verbatim, empty opening message, empty launch instruction", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaude(rig);

	const { runId, taskId } = await createChatSession(rig, computerId, "Chat");

	const task = rig.task.rows.get(taskId);
	expect(task?.description).toBe("");
	expect(task?.openingMessage).toBe("");
	const { pendingCommands } = await client().computers.heartbeat();
	expect(pendingCommands).toHaveLength(1);
	expect(pendingCommands[0]).toMatchObject({ description: "", runId });
});

it("create without a name auto-generates a server-side session name", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaude(rig);

	const { taskId } = await createChatSession(rig, computerId);

	const task = rig.task.rows.get(taskId);
	expect(task?.name).toMatch(AUTO_SESSION_NAME);
});

it("resume appends a run whose launch payload carries resumeAgentSessionId", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaude(rig);
	const { runId, taskId } = await createChatSession(rig, computerId, "Chat");
	await finishRun(rig, client, runId, "claude-session-42");

	const { runId: resumedRunId } = await rig
		.userClientFor(ALICE)
		.tasks.resume({ taskId });

	expect(resumedRunId).not.toBe(runId);
	const resumedRun = rig.run.rows.get(resumedRunId);
	expect(resumedRun).toMatchObject({
		resumeAgentSessionId: "claude-session-42",
		status: "created",
		taskId,
		workspaceKind: "standalone",
	});
	// A fresh credential — never the finished run's.
	expect(resumedRun?.sessionTokenId).toBeTruthy();
	expect(resumedRun?.sessionTokenId).not.toBe(
		rig.run.rows.get(runId)?.sessionTokenId
	);

	const { pendingCommands } = await client().computers.heartbeat();
	expect(pendingCommands).toHaveLength(1);
	expect(pendingCommands[0]).toMatchObject({
		description: "",
		resumeAgentSessionId: "claude-session-42",
		runId: resumedRunId,
	});
});

it("resume without a reported agentSessionId launches cold — the payload omits the key", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaude(rig);
	const { runId, taskId } = await createChatSession(rig, computerId, "Chat");
	await finishRun(rig, client, runId, null);

	const { runId: resumedRunId } = await rig
		.userClientFor(ALICE)
		.tasks.resume({ taskId });

	expect(rig.run.rows.get(resumedRunId)?.resumeAgentSessionId).toBeNull();
	const { pendingCommands } = await client().computers.heartbeat();
	expect(pendingCommands[0]?.runId).toBe(resumedRunId);
	expect(pendingCommands[0]).not.toHaveProperty("resumeAgentSessionId");
});

it("resume is rejected while the latest run is not terminal, for foreign users and offline computers", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaude(rig);
	const { runId, taskId } = await createChatSession(rig, computerId, "Chat");
	const client = rig.userClientFor(ALICE);

	// created, then running: the session is still going — no second run.
	await expect(client.tasks.resume({ taskId })).rejects.toMatchObject({
		code: "PRECONDITION_FAILED",
		message: expect.stringMatching(STILL_RUNNING),
	});
	await rig.run.updateStatus(runId, { status: "running" });
	await expect(client.tasks.resume({ taskId })).rejects.toMatchObject({
		code: "PRECONDITION_FAILED",
	});

	await rig.run.updateStatus(runId, { status: "completed" });
	await expect(
		rig.userClientFor(BOB).tasks.resume({ taskId })
	).rejects.toMatchObject({ code: "NOT_FOUND" });

	const row = rig.rows.get(computerId);
	if (row) {
		rig.rows.set(computerId, {
			...row,
			lastSeenAt: new Date(Date.now() - COMPUTER_OFFLINE_AFTER_MS - 1),
		});
	}
	await expect(client.tasks.resume({ taskId })).rejects.toMatchObject({
		code: "PRECONDITION_FAILED",
	});
	expect(rig.run.rows.size).toBe(1);
});

it("list filters by computerId and agentKind and flags agentSessionId presence", async () => {
	const rig = buildComputerRig();
	const first = await pairClaude(rig);
	const second = await pairClaude(rig);
	const created = await createChatSession(rig, first.computerId, "On A");
	await createChatSession(rig, second.computerId, "On B");
	const client = rig.userClientFor(ALICE);

	expect(await client.tasks.list()).toHaveLength(2);
	const onlyFirst = await client.tasks.list({
		computerId: first.computerId,
	});
	expect(onlyFirst.map((task) => task.name)).toEqual(["On A"]);
	expect(await client.tasks.list({ agentKind: "claude-code" })).toHaveLength(2);
	expect(await client.tasks.list({ agentKind: "codex" })).toEqual([]);
	expect(onlyFirst[0]?.latestRun?.hasAgentSessionId).toBe(false);

	await finishRun(rig, first.client, created.runId, "claude-session-7");
	const after = await client.tasks.list({ computerId: first.computerId });
	expect(after[0]?.latestRun).toMatchObject({
		hasAgentSessionId: true,
		status: "completed",
	});
});

it("resume carries the previous run's model and permission mode into the new run's startup config", async () => {
	// The SDK can't be ASKED what it's running, so a resumed session only knows
	// its model/mode if the launch passes them explicitly — hence the carry.
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaude(rig);
	const { runId, taskId } = await createChatSession(rig, computerId, "Chat");
	const session = await finishRun(rig, client, runId, "claude-session-42");
	await rig.bridgeSession.setLastSessionInfo(session.id, {
		model: "opus",
		permissionMode: "acceptEdits",
	});

	const { runId: resumedRunId } = await rig
		.userClientFor(ALICE)
		.tasks.resume({ taskId });

	const tokenId = rig.run.rows.get(resumedRunId)?.sessionTokenId ?? "";
	const token = await rig.bridgeToken.getById(tokenId, ALICE.id);
	expect(token?.config).toMatchObject({
		model: "opus",
		permissionMode: "acceptEdits",
	});
});

it("resume leaves the new run's config unset when the previous session reported nothing", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaude(rig);
	const { runId, taskId } = await createChatSession(rig, computerId, "Chat");
	await finishRun(rig, client, runId, "claude-session-42");

	const { runId: resumedRunId } = await rig
		.userClientFor(ALICE)
		.tasks.resume({ taskId });

	const tokenId = rig.run.rows.get(resumedRunId)?.sessionTokenId ?? "";
	const token = await rig.bridgeToken.getById(tokenId, ALICE.id);
	// Not a guessed default — nothing was ever observed, so nothing is pinned.
	expect(token?.config ?? null).toBeNull();
});
