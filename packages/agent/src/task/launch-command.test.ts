import { expect, it } from "vitest";
import { buildLaunchCommand } from "./launch-command";
import type { IssueSnapshot } from "./task-ports";

// S2-T2: the Launch Command payload (master spec §9.1, design D4) — a pure
// derivation from the Task, the Run and the pre-issued session credential.

const MISSING_REPOSITORY_ERROR = /repository/;

const TASK = {
	id: "task-1",
	description: "Fix the flaky login test using /tdd please",
	repositoryFullName: null as string | null,
	repositoryUrl: null as string | null,
};

const RUN = {
	id: "run-1",
	agentKind: "claude-code" as const,
	issueSnapshots: [] as IssueSnapshot[],
	workspaceKind: "standalone" as const,
};

it("builds a standalone launch command with the description verbatim", () => {
	const command = buildLaunchCommand(TASK, RUN, "bt_secret");
	expect(command).toEqual({
		kind: "launch",
		taskId: "task-1",
		runId: "run-1",
		agentKind: "claude-code",
		workspace: { kind: "standalone" },
		description: "Fix the flaky login test using /tdd please",
		issueSnapshots: [],
		sessionCredential: "bt_secret",
	});
});

it("builds a repository workspace from the task's repository identity", () => {
	const command = buildLaunchCommand(
		{
			...TASK,
			repositoryFullName: "acme/app",
			repositoryUrl: "https://github.com/acme/app",
		},
		{ ...RUN, workspaceKind: "repository" },
		"bt_secret"
	);
	expect(command.workspace).toEqual({
		kind: "repository",
		fullName: "acme/app",
		cloneUrl: "https://github.com/acme/app.git",
		defaultBranch: "main",
	});
});

it("keeps an explicit .git clone URL as-is", () => {
	const command = buildLaunchCommand(
		{
			...TASK,
			repositoryFullName: "acme/app",
			repositoryUrl: "https://github.com/acme/app.git",
		},
		{ ...RUN, workspaceKind: "repository" },
		"bt_secret"
	);
	expect(command.workspace).toMatchObject({
		cloneUrl: "https://github.com/acme/app.git",
	});
});

it("carries the run's issue snapshots in order", () => {
	const issueSnapshots: IssueSnapshot[] = [
		{ number: 7, title: "B", body: "b", url: "https://x/7" },
		{ number: 3, title: "A", body: "a", url: "https://x/3" },
	];
	const command = buildLaunchCommand(TASK, { ...RUN, issueSnapshots }, "bt_s");
	expect(command.issueSnapshots).toEqual(issueSnapshots);
});

it("throws when a repository run's task has no repository identity", () => {
	expect(() =>
		buildLaunchCommand(TASK, { ...RUN, workspaceKind: "repository" }, "bt_s")
	).toThrow(MISSING_REPOSITORY_ERROR);
});
