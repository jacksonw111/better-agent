import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import { expect, it } from "vitest";
import { ALICE, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	pairComputer,
	type RegistrationInput,
	type Rig,
} from "./runs-test-helpers";

// S25-T2: §19.2 cross-layer Task Start flow — one test per full chain, glued
// through the real router client at every hop: tasks.create → heartbeat
// pendingCommands → runs.ackLaunch → runs.updateStatus progression →
// bridge.startSession with the launch payload's OWN sessionCredential. The
// per-endpoint behavior is already covered by tasks.test.ts / runs*.test.ts /
// bridge-run-binding.test.ts — these assert that the layers actually compose:
// what the client receives is what the next layer accepts.

const DESCRIPTION = "Refactor the session auth flow with /tdd";
const TASK_NAME = "Auth refactor sprint";
const REAL_ERROR = "fatal: runtime claude-code exited with code 1";
/** Run session credentials are raw bridge tokens (run-session-credential.ts). */
const CREDENTIAL_SHAPE = /^bt_/;
/** The client's §11.2 progress reports up to a live runtime. */
const PROGRESS = [
	"preparing_workspace",
	"starting_runtime",
	"running",
] as const;

type Paired = Awaited<ReturnType<typeof pairComputer>>;

/** Pairs a Claude-capable computer and starts a Task on it, exactly as the
 * wizard would (§8.5) — the entry hop of every chain below. */
async function startTask(rig: Rig, overrides?: Partial<RegistrationInput>) {
	const paired = await pairComputer(rig, ALICE, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
		...overrides,
	});
	const created = await rig.userClientFor(ALICE).tasks.create({
		agentKind: "claude-code",
		computerId: paired.computerId,
		description: DESCRIPTION,
		name: TASK_NAME,
	});
	return { ...paired, ...created };
}

/** The delivery hop: one heartbeat, expecting exactly one launch payload. */
async function heartbeatLaunch(client: Paired["client"]) {
	const { pendingCommands } = await client().computers.heartbeat();
	const [command] = pendingCommands;
	if (pendingCommands.length !== 1 || !command) {
		throw new Error(
			`expected exactly one pending launch, got ${pendingCommands.length}`
		);
	}
	return command;
}

/** The CLI hop: authenticates the payload's raw sessionCredential the same
 * way the production bearer path does (context.ts resolveAuthedBridgeToken:
 * hash → findByHash → revocation check) and returns a bridge client for it. */
async function bridgeClientFromCredential(rig: Rig, sessionCredential: string) {
	const found = await rig.bridgeToken.findByHash(hashToken(sessionCredential));
	if (!found || found.revokedAt) {
		throw new Error("launch sessionCredential does not authenticate");
	}
	return rig.bridgeClientFor({ tokenId: found.id, userId: found.userId });
}

/** Non-null row lookup keeping assertion bodies free of `?.` branches. */
function mustGet<T>(map: Map<string, T>, id: string): T {
	const row = map.get(id);
	if (!row) {
		throw new Error(`expected row ${id} to exist`);
	}
	return row;
}

/** Runs the client half of a launch to a live runtime: ack + §11.2 reports. */
async function ackAndRunToRunning(client: Paired["client"], runId: string) {
	await expect(client().runs.ackLaunch({ runId })).resolves.toEqual({
		ok: true,
	});
	for (const status of PROGRESS) {
		await expect(
			client().runs.updateStatus({ runId, status })
		).resolves.toEqual({ ok: true });
	}
}

it("standalone chain: create → launch payload → ack → running → session bound both ways", async () => {
	const rig = buildComputerRig();
	const { client, runId, taskId } = await startTask(rig);
	expect(rig.task.rows.has(taskId)).toBe(true);
	expect(mustGet(rig.run.rows, runId).status).toBe("created");

	// The payload the computer receives is the Task the wizard submitted,
	// verbatim, plus the run's pre-issued credential.
	const launch = await heartbeatLaunch(client);
	expect(launch).toEqual({
		kind: "launch",
		taskId,
		runId,
		agentKind: "claude-code",
		workspace: { kind: "standalone" },
		description: DESCRIPTION,
		issueSnapshots: [],
		sessionCredential: expect.stringMatching(CREDENTIAL_SHAPE),
	} satisfies RunLaunchCommand);

	await ackAndRunToRunning(client, runId);
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);

	// The CLI hop: the payload's credential starts the relay session for THIS
	// run, and the binding lands on both sides.
	const cli = await bridgeClientFromCredential(rig, launch.sessionCredential);
	const { sessionId } = await cli.bridge.startSession({
		agentKind: "claude-code",
		runId,
	});
	expect((await rig.bridgeSession.get(sessionId))?.runId).toBe(runId);
	const run = mustGet(rig.run.rows, runId);
	expect(run.sessionId).toBe(sessionId);
	expect(run.status).toBe("running");
});

it("redelivery chain: byte-identical payload every heartbeat until the ack, then never again", async () => {
	const rig = buildComputerRig();
	const { client, runId } = await startTask(rig);

	// Pre-ack: the whole payload — credential included — is stable across
	// deliveries, so a slow computer never sees two divergent launches.
	const first = await heartbeatLaunch(client);
	expect(await heartbeatLaunch(client)).toEqual(first);
	expect(await heartbeatLaunch(client)).toEqual(first);

	await expect(client().runs.ackLaunch({ runId })).resolves.toEqual({
		ok: true,
	});
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);

	// A duplicate ack (redelivery race, client restart) is ok:false and the
	// run stays exactly where the first ack put it.
	await expect(client().runs.ackLaunch({ runId })).resolves.toEqual({
		ok: false,
	});
	expect(mustGet(rig.run.rows, runId).status).toBe("launching");
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);
});

it("failure chain: real error recorded, task intact, retry launches a fresh credential", async () => {
	const rig = buildComputerRig();
	const { client, runId, taskId } = await startTask(rig);
	const firstLaunch = await heartbeatLaunch(client);
	await client().runs.ackLaunch({ runId });
	await client().runs.updateStatus({ runId, status: "preparing_workspace" });
	await expect(
		client().runs.updateStatus({
			errorMessage: REAL_ERROR,
			runId,
			status: "failed",
		})
	).resolves.toEqual({ ok: true });

	const failedRun = mustGet(rig.run.rows, runId);
	expect(failedRun).toMatchObject({
		errorMessage: REAL_ERROR,
		status: "failed",
	});
	const task = mustGet(rig.task.rows, taskId);
	expect(task.status).toBe("active");
	expect(task.openingMessage).toContain(DESCRIPTION);

	// Retry: a brand-new run is delivered with the SAME verbatim description
	// but a fresh launch key and a fresh raw credential.
	const { runId: retryRunId } = await rig
		.userClientFor(ALICE)
		.tasks.retry({ taskId });
	const retryLaunch = await heartbeatLaunch(client);
	expect(retryLaunch.runId).toBe(retryRunId);
	expect(retryLaunch.description).toBe(DESCRIPTION);
	expect(retryLaunch.sessionCredential).not.toBe(firstLaunch.sessionCredential);
	expect(mustGet(rig.run.rows, retryRunId).launchKey).not.toBe(
		failedRun.launchKey
	);

	// Driving the retry run all the way up leaves the failed run untouched.
	await ackAndRunToRunning(client, retryRunId);
	expect(mustGet(rig.run.rows, runId)).toEqual(failedRun);
});

it("no hop of the chain — success or failure — writes lifecycle chat messages", async () => {
	const rig = buildComputerRig();
	const { client, runId, taskId } = await startTask(rig);
	expect(rig.bridgeMessages.size).toBe(0);

	const launch = await heartbeatLaunch(client);
	await ackAndRunToRunning(client, runId);
	expect(rig.bridgeMessages.size).toBe(0);

	const cli = await bridgeClientFromCredential(rig, launch.sessionCredential);
	await cli.bridge.startSession({ agentKind: "claude-code", runId });
	expect(rig.bridgeMessages.size).toBe(0);

	// Failure + retry don't narrate into chat either.
	await client().runs.updateStatus({
		errorMessage: REAL_ERROR,
		runId,
		status: "failed",
	});
	await rig.userClientFor(ALICE).tasks.retry({ taskId });
	await client().computers.heartbeat();
	expect(rig.bridgeMessages.size).toBe(0);
});

it("the task name never reaches the agent: absent from the launch payload's instructions", async () => {
	const rig = buildComputerRig();
	const { client, taskId } = await startTask(rig);

	const launch = await heartbeatLaunch(client);
	expect(launch.description).toBe(DESCRIPTION);
	expect(launch.description).not.toContain(TASK_NAME);

	// The opening message opens with the verbatim description — the name is
	// never prepended as a duplicate headline.
	const task = mustGet(rig.task.rows, taskId);
	expect(task.openingMessage.startsWith(DESCRIPTION)).toBe(true);
});

it("a computer whose gh is not even installed still runs the whole chain (§16)", async () => {
	const rig = buildComputerRig();
	const { client, runId } = await startTask(rig, {
		toolInventory: [
			{ installed: true, name: "git" },
			{ installed: false, name: "gh" },
		],
	});

	const launch = await heartbeatLaunch(client);
	await ackAndRunToRunning(client, runId);
	const cli = await bridgeClientFromCredential(rig, launch.sessionCredential);
	const { sessionId } = await cli.bridge.startSession({
		agentKind: "claude-code",
		runId,
	});

	const run = mustGet(rig.run.rows, runId);
	expect(run.status).toBe("running");
	expect(run.sessionId).toBe(sessionId);
});
