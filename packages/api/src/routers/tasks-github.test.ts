import type {
	GithubIssueDetail,
	GithubRepositorySummary,
} from "@better-agent/agent/github/github-ports";
import { expect, it } from "vitest";
import { ALICE, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	connectGithub,
	pairComputer,
	type Rig,
} from "./runs-test-helpers";

// S4-T2 (§19.2, GitHub side): repository-backed Task Start. Issues are only
// valid inside a repository, snapshots are title/body/url (never comments)
// captured per Run in the user's order, the Launch payload carries the real
// GitHub metadata, and retry re-fetches each linked issue's LATEST snapshot —
// keeping the previous one when an issue became unreachable (§6.15/§16).

const REPO: GithubRepositorySummary = {
	fullName: "octo/hello",
	url: "https://github.com/octo/hello",
	cloneUrl: "https://github.com/octo/hello.git",
	defaultBranch: "develop",
	private: false,
	description: "Says hello",
};

const ISSUE_7: GithubIssueDetail = {
	number: 7,
	title: "Crash on start",
	body: "Stack trace…",
	url: "https://github.com/octo/hello/issues/7",
};

const MISSING_ISSUE_NUMBER = 42;

const ISSUE_9: GithubIssueDetail = {
	number: 9,
	title: "Add dark mode",
	body: "",
	url: "https://github.com/octo/hello/issues/9",
};

function seedRepo(rig: Rig) {
	rig.github.repositories.set(REPO.fullName, REPO);
	rig.github.issues.set(
		rig.github.issueKey(REPO.fullName, ISSUE_7.number),
		ISSUE_7
	);
	rig.github.issues.set(
		rig.github.issueKey(REPO.fullName, ISSUE_9.number),
		ISSUE_9
	);
}

async function pairClaudeComputer(rig: Rig) {
	return await pairComputer(rig, ALICE, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
	});
}

function createInput(computerId: string) {
	return {
		agentKind: "claude-code" as const,
		computerId,
		description: "Fix the crash with /tdd",
		name: "Crash fix",
	};
}

function expectNoRowsLeft(rig: Rig) {
	expect(rig.task.rows.size).toBe(0);
	expect(rig.run.rows.size).toBe(0);
}

/** Start a repository task with issues [9, 7] and fail its first run, ready
 * for retry cases. */
async function startAndFailRepoTask(rig: Rig) {
	const { client, computerId } = await pairClaudeComputer(rig);
	await connectGithub(rig);
	seedRepo(rig);
	const { runId, taskId } = await rig.userClientFor(ALICE).tasks.create({
		...createInput(computerId),
		issueNumbers: [ISSUE_9.number, ISSUE_7.number],
		repositoryFullName: REPO.fullName,
	});
	await client().runs.ackLaunch({ runId });
	await rig.run.updateStatus(runId, {
		errorMessage: "clone failed",
		status: "failed",
	});
	return { client, computerId, runId, taskId };
}

it("rejects linked issues without a repository and leaves no rows (§19.2)", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	await connectGithub(rig);

	await expect(
		rig.userClientFor(ALICE).tasks.create({
			...createInput(computerId),
			issueNumbers: [ISSUE_7.number],
		})
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expectNoRowsLeft(rig);
});

it("rejects a repository task without a GitHub connection", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	seedRepo(rig);

	await expect(
		rig.userClientFor(ALICE).tasks.create({
			...createInput(computerId),
			repositoryFullName: REPO.fullName,
		})
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expectNoRowsLeft(rig);
});

it("rejects a repository the connection cannot access", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	await connectGithub(rig);

	await expect(
		rig.userClientFor(ALICE).tasks.create({
			...createInput(computerId),
			repositoryFullName: "octo/private-elsewhere",
		})
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expectNoRowsLeft(rig);
});

it("rejects an issue that does not belong to the repository, naming it", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	await connectGithub(rig);
	seedRepo(rig);

	await expect(
		rig.userClientFor(ALICE).tasks.create({
			...createInput(computerId),
			issueNumbers: [ISSUE_7.number, MISSING_ISSUE_NUMBER],
			repositoryFullName: REPO.fullName,
		})
	).rejects.toMatchObject({
		code: "BAD_REQUEST",
		message: expect.stringContaining(`#${MISSING_ISSUE_NUMBER}`),
	});
	expectNoRowsLeft(rig);
});

it("saves repository metadata, per-run snapshots and the GitHub opening block", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	await connectGithub(rig);
	seedRepo(rig);

	const { runId, taskId } = await rig.userClientFor(ALICE).tasks.create({
		...createInput(computerId),
		issueNumbers: [ISSUE_9.number, ISSUE_7.number],
		repositoryFullName: REPO.fullName,
	});

	const task = rig.task.rows.get(taskId);
	expect(task).toMatchObject({
		repositoryCloneUrl: "https://github.com/octo/hello.git",
		repositoryDefaultBranch: "develop",
		repositoryFullName: "octo/hello",
		repositoryUrl: "https://github.com/octo/hello",
	});

	// Snapshots belong to the Run: title/body/url in the USER's order (9 then
	// 7), and nothing else — comments never enter the snapshot (§6.15).
	const run = rig.run.rows.get(runId);
	expect(run?.workspaceKind).toBe("repository");
	expect(run?.issueSnapshots).toEqual([ISSUE_9, ISSUE_7]);
	for (const snapshot of run?.issueSnapshots ?? []) {
		expect(Object.keys(snapshot).sort()).toEqual([
			"body",
			"number",
			"title",
			"url",
		]);
	}

	// §10.1: Repository line + one issue section per issue, in order.
	const openingMessage = task?.openingMessage ?? "";
	expect(openingMessage).toContain(
		"## GitHub context\nRepository: https://github.com/octo/hello"
	);
	expect(openingMessage).toContain("### Issue #9: Add dark mode");
	expect(openingMessage).toContain("### Issue #7: Crash on start");
	expect(openingMessage.indexOf("### Issue #9")).toBeLessThan(
		openingMessage.indexOf("### Issue #7")
	);
	expect(openingMessage).toContain("- Workspace: repository workspace");
});

it("delivers a launch payload with the real GitHub metadata and snapshots", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaudeComputer(rig);
	await connectGithub(rig);
	seedRepo(rig);

	await rig.userClientFor(ALICE).tasks.create({
		...createInput(computerId),
		issueNumbers: [ISSUE_7.number],
		repositoryFullName: REPO.fullName,
	});

	const { pendingCommands } = await client().computers.heartbeat();
	expect(pendingCommands).toHaveLength(1);
	expect(pendingCommands[0]).toMatchObject({
		issueSnapshots: [ISSUE_7],
		repositoryUrl: "https://github.com/octo/hello",
		workspace: {
			kind: "repository",
			fullName: "octo/hello",
			cloneUrl: "https://github.com/octo/hello.git",
			defaultBranch: "develop",
		},
	});
});

it("retry re-fetches the latest issue snapshots for the new run (§6.15)", async () => {
	const rig = buildComputerRig();
	const { runId, taskId } = await startAndFailRepoTask(rig);

	// The issue is edited between the two runs.
	rig.github.issues.set(rig.github.issueKey(REPO.fullName, ISSUE_7.number), {
		...ISSUE_7,
		body: "Now with repro steps",
		title: "Crash on start (repro attached)",
	});

	const { runId: retryRunId } = await rig
		.userClientFor(ALICE)
		.tasks.retry({ taskId });

	// The new Run sees the latest state, in the same order; the old Run still
	// records what ITS launch saw.
	expect(rig.run.rows.get(retryRunId)?.issueSnapshots).toEqual([
		ISSUE_9,
		{
			...ISSUE_7,
			body: "Now with repro steps",
			title: "Crash on start (repro attached)",
		},
	]);
	expect(rig.run.rows.get(runId)?.issueSnapshots).toEqual([ISSUE_9, ISSUE_7]);
});

it("retry keeps the previous snapshot for a deleted or erroring issue", async () => {
	const rig = buildComputerRig();
	const { taskId } = await startAndFailRepoTask(rig);

	// #9 was deleted (resolves null); #7 errors at the transport level.
	rig.github.issues.delete(rig.github.issueKey(REPO.fullName, ISSUE_9.number));
	rig.github.failingIssues.add(
		rig.github.issueKey(REPO.fullName, ISSUE_7.number)
	);

	const { runId: retryRunId } = await rig
		.userClientFor(ALICE)
		.tasks.retry({ taskId });

	// Neither problem blocks the retry — the last-known snapshots carry over.
	expect(rig.run.rows.get(retryRunId)?.issueSnapshots).toEqual([
		ISSUE_9,
		ISSUE_7,
	]);
});

it("retry survives a removed GitHub connection with the previous snapshots", async () => {
	const rig = buildComputerRig();
	const { taskId } = await startAndFailRepoTask(rig);
	await rig.githubConnection.deleteByUser(ALICE.id);

	const { runId: retryRunId } = await rig
		.userClientFor(ALICE)
		.tasks.retry({ taskId });

	expect(rig.run.rows.get(retryRunId)?.issueSnapshots).toEqual([
		ISSUE_9,
		ISSUE_7,
	]);
});
