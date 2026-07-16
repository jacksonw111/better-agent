import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import { describe, expect, it, vi } from "vitest";
import { createLaunchHandler, type LaunchHandlerDeps } from "./launch-handler";
import type { GitExec } from "./repo-cache";
import type { RepoLockDeps } from "./repo-lock";
import { prepareRepositoryRunWorkspace } from "./repo-workspace";

// S4-T3 (master spec §16): Repository Sync Failure → the Run fails with the
// REAL git stderr as its errorMessage — the launch handler wired to the real
// repository-workspace preparer, only git faked. The Task and its Opening
// Message are untouched by a failed Run (server-side launch-command tests
// cover that side).

const BASE = "/base";
const TASK_ID = "5b2c1d00-0000-4000-8000-0000000task1";
const RUN_ID = "9a1f0e00-0000-4000-8000-00000000run1";

const REPOSITORY = {
	cloneUrl: "https://github.com/acme/widgets.git",
	defaultBranch: "main",
	fullName: "acme/widgets",
	kind: "repository",
} as const;

function noopLock(): RepoLockDeps {
	return {
		statMtimeMs: () => Promise.resolve(null),
		unlinkIfExists: () => Promise.resolve(),
		writeExclusive: () => Promise.resolve(true),
	};
}

function repoLaunchHandlerWorld(exec: GitExec) {
	const statuses: { errorMessage?: string; status: string }[] = [];
	const deps: LaunchHandlerDeps = {
		ackLaunch: () => Promise.resolve({ ok: true }),
		buildStartContext: () => Promise.resolve("CTX"),
		log: vi.fn(),
		prepareWorkspace: (command: RunLaunchCommand) =>
			command.workspace.kind === "repository"
				? prepareRepositoryRunWorkspace(
						{
							runId: command.runId,
							taskId: command.taskId,
							workspace: command.workspace,
						},
						{
							basePath: BASE,
							exec,
							exists: () => Promise.resolve(false),
							lock: noopLock(),
							mkdirRecursive: () => Promise.resolve(),
						}
					)
				: Promise.reject(new Error("standalone not under test")),
		runSession: () => Promise.resolve({ done: Promise.resolve() }),
		signal: new AbortController().signal,
		updateRunStatus: (report) => {
			statuses.push({
				errorMessage: report.errorMessage,
				status: report.status,
			});
			return Promise.resolve({ ok: true });
		},
	};
	return { deps, statuses };
}

describe("repository launch failure (launch handler integration)", () => {
	it("reports failed with the REAL git stderr as the Run's errorMessage (§16)", async () => {
		const exec: GitExec = () =>
			Promise.resolve({
				code: 128,
				stderr: "fatal: Authentication failed for 'https://github.com/'",
				stdout: "",
			});
		const { deps, statuses } = repoLaunchHandlerWorld(exec);
		await createLaunchHandler(deps).handle({
			agentKind: "claude-code",
			description: "Fix the bug",
			issueSnapshots: [],
			kind: "launch",
			repositoryUrl: "https://github.com/acme/widgets",
			runId: RUN_ID,
			sessionCredential: "bt_secret",
			taskId: TASK_ID,
			workspace: REPOSITORY,
		});
		expect(statuses).toEqual([
			{ errorMessage: undefined, status: "preparing_workspace" },
			{
				errorMessage: expect.stringContaining(
					"fatal: Authentication failed for 'https://github.com/'"
				),
				status: "failed",
			},
		]);
	});
});
