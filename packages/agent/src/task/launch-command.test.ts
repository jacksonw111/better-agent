import { expect, it } from "vitest";
import { buildLaunchCommand } from "./launch-command";
import type { IssueSnapshot } from "./task-ports";

// S2-T2 + S4-T2: the Launch Command payload (master spec §9.1, design D4) — a
// pure derivation from the Task, the Run and the pre-issued session
// credential. Repository payloads carry the GitHub-resolved metadata saved at
// Task creation (real cloneUrl + defaultBranch — never an assumed "main") and
// the canonical repositoryUrl for the client's start-context Repository line.

const MISSING_REPOSITORY_ERROR = /repository/;

const TASK = {
	id: "task-1",
	description: "Fix the flaky login test using /tdd please",
	repositoryFullName: null as string | null,
	repositoryUrl: null as string | null,
	repositoryCloneUrl: null as string | null,
	repositoryDefaultBranch: null as string | null,
};

const REPO_TASK = {
	...TASK,
	repositoryFullName: "acme/app",
	repositoryUrl: "https://github.com/acme/app",
	repositoryCloneUrl: "https://github.com/acme/app.git",
	repositoryDefaultBranch: "develop",
};

const RUN = {
	id: "run-1",
	agentKind: "claude-code" as const,
	issueSnapshots: [] as IssueSnapshot[],
	resumeAgentSessionId: null as string | null,
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
		repositoryUrl: null,
		sessionCredential: "bt_secret",
	});
});

it("builds the repository workspace from the task's saved GitHub metadata", () => {
	const command = buildLaunchCommand(
		REPO_TASK,
		{ ...RUN, workspaceKind: "repository" },
		"bt_secret"
	);
	expect(command.workspace).toEqual({
		kind: "repository",
		fullName: "acme/app",
		cloneUrl: "https://github.com/acme/app.git",
		defaultBranch: "develop",
	});
	expect(command.repositoryUrl).toBe("https://github.com/acme/app");
});

it("carries the run's issue snapshots in order", () => {
	const issueSnapshots: IssueSnapshot[] = [
		{ number: 7, title: "B", body: "b", url: "https://x/7" },
		{ number: 3, title: "A", body: "a", url: "https://x/3" },
	];
	const command = buildLaunchCommand(TASK, { ...RUN, issueSnapshots }, "bt_s");
	expect(command.issueSnapshots).toEqual(issueSnapshots);
});

it("carries resumeAgentSessionId only when the run has one (P1 session resume)", () => {
	const resumed = buildLaunchCommand(
		TASK,
		{ ...RUN, resumeAgentSessionId: "claude-abc" },
		"bt_s"
	);
	expect(resumed.resumeAgentSessionId).toBe("claude-abc");
	// A cold start omits the key entirely — the client never sees a null.
	expect(buildLaunchCommand(TASK, RUN, "bt_s")).not.toHaveProperty(
		"resumeAgentSessionId"
	);
});

it("throws when a repository run's task has no repository identity", () => {
	expect(() =>
		buildLaunchCommand(TASK, { ...RUN, workspaceKind: "repository" }, "bt_s")
	).toThrow(MISSING_REPOSITORY_ERROR);
});

it("throws when the saved repository metadata is incomplete — no assumed branch", () => {
	expect(() =>
		buildLaunchCommand(
			{ ...REPO_TASK, repositoryDefaultBranch: null },
			{ ...RUN, workspaceKind: "repository" },
			"bt_s"
		)
	).toThrow(MISSING_REPOSITORY_ERROR);
	expect(() =>
		buildLaunchCommand(
			{ ...REPO_TASK, repositoryCloneUrl: null },
			{ ...RUN, workspaceKind: "repository" },
			"bt_s"
		)
	).toThrow(MISSING_REPOSITORY_ERROR);
});
