import { describe, expect, it } from "vitest";
import type { GitExec } from "./repo-cache";
import type { RepoLockDeps } from "./repo-lock";
import {
	prepareRepositoryRunWorkspace,
	prepareRepoWorktree,
	runBranchName,
	taskRepoWorkspaceDir,
} from "./repo-workspace";

// S4-T3 (design D5, master spec §6.17/§9.2/§18.5): every repository Task gets
// its own independent writable Workspace — a `git worktree add` off the shared
// bare cache at `<base>/tasks/<taskId>/repo`, on branch `task/<runId[:8]>`.
// A retry reuses a still-valid worktree directory as-is, and reuses an
// already-created branch (after pruning the stale registration) instead of
// erroring. Any git failure surfaces the REAL stderr, which the launch
// handler reports as the Run's `failed` errorMessage (§16) — the Task and its
// Opening Message are untouched (server-side tests cover that).

const BASE = "/base";
const TASK_ID = "5b2c1d00-0000-4000-8000-0000000task1";
const RUN_ID = "9a1f0e00-0000-4000-8000-00000000run1";
const BARE_DIR = "/base/cache/repos/acme__widgets";
const WORKSPACE = `/base/tasks/${TASK_ID}/repo`;
const BRANCH = "task/9a1f0e00";

const REPOSITORY = {
	cloneUrl: "https://github.com/acme/widgets.git",
	defaultBranch: "main",
	fullName: "acme/widgets",
	kind: "repository",
} as const;

function recordingExec(
	recorded: string[][],
	result: (args: string[]) => { code: number | null; stderr: string } = () => ({
		code: 0,
		stderr: "",
	})
): GitExec {
	return (args) => {
		recorded.push([...args]);
		return Promise.resolve({ stdout: "", ...result(args) });
	};
}

function noopLock(): RepoLockDeps {
	return {
		statMtimeMs: () => Promise.resolve(null),
		unlinkIfExists: () => Promise.resolve(),
		writeExclusive: () => Promise.resolve(true),
	};
}

describe("workspace layout", () => {
	it("puts the repository workspace at <base>/tasks/<taskId>/repo", () => {
		expect(taskRepoWorkspaceDir(BASE, TASK_ID)).toBe(WORKSPACE);
	});

	it("names the run branch task/<first 8 chars of runId>", () => {
		expect(runBranchName(RUN_ID)).toBe(BRANCH);
	});
});

describe("prepareRepoWorktree - fresh workspace", () => {
	it("adds a worktree on a new task branch off origin/<defaultBranch>", async () => {
		const commands: string[][] = [];
		const path = await prepareRepoWorktree(
			{ defaultBranch: "main", runId: RUN_ID, taskId: TASK_ID },
			{
				bareDir: BARE_DIR,
				basePath: BASE,
				exec: recordingExec(commands, (args) =>
					args.includes("rev-parse")
						? { code: 1, stderr: "" } // branch does not exist yet
						: { code: 0, stderr: "" }
				),
				exists: () => Promise.resolve(false),
			}
		);
		expect(path).toBe(WORKSPACE);
		expect(commands).toEqual([
			[
				"--git-dir",
				BARE_DIR,
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/heads/${BRANCH}`,
			],
			[
				"--git-dir",
				BARE_DIR,
				"worktree",
				"add",
				WORKSPACE,
				"-b",
				BRANCH,
				"origin/main",
			],
		]);
	});
});

describe("prepareRepoWorktree - retry reuse", () => {
	it("reuses a still-valid worktree directory without running git", async () => {
		const commands: string[][] = [];
		const path = await prepareRepoWorktree(
			{ defaultBranch: "main", runId: RUN_ID, taskId: TASK_ID },
			{
				bareDir: BARE_DIR,
				basePath: BASE,
				exec: recordingExec(commands),
				exists: (candidate) =>
					Promise.resolve(candidate === `${WORKSPACE}/.git`),
			}
		);
		expect(path).toBe(WORKSPACE);
		expect(commands).toEqual([]);
	});

	it("reuses an existing task branch (pruning the stale registration) when the directory is gone", async () => {
		const commands: string[][] = [];
		const path = await prepareRepoWorktree(
			{ defaultBranch: "main", runId: RUN_ID, taskId: TASK_ID },
			{
				bareDir: BARE_DIR,
				basePath: BASE,
				exec: recordingExec(commands), // rev-parse exits 0: branch exists
				exists: () => Promise.resolve(false),
			}
		);
		expect(path).toBe(WORKSPACE);
		expect(commands).toEqual([
			[
				"--git-dir",
				BARE_DIR,
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/heads/${BRANCH}`,
			],
			["--git-dir", BARE_DIR, "worktree", "prune"],
			["--git-dir", BARE_DIR, "worktree", "add", WORKSPACE, BRANCH],
		]);
	});
});

describe("prepareRepoWorktree - git failure", () => {
	it("throws the REAL worktree stderr", async () => {
		const exec: GitExec = (args) =>
			Promise.resolve(
				args.includes("rev-parse")
					? { code: 1, stderr: "", stdout: "" }
					: {
							code: 128,
							stderr: "fatal: could not create work tree dir: disk full",
							stdout: "",
						}
			);
		await expect(
			prepareRepoWorktree(
				{ defaultBranch: "main", runId: RUN_ID, taskId: TASK_ID },
				{
					bareDir: BARE_DIR,
					basePath: BASE,
					exec,
					exists: () => Promise.resolve(false),
				}
			)
		).rejects.toThrow("fatal: could not create work tree dir: disk full");
	});
});

function orchestratorWorld() {
	const commands: string[][] = [];
	const cloned = new Set<string>();
	const exec: GitExec = (args) => {
		commands.push([...args]);
		if (args[0] === "clone") {
			cloned.add(args.at(-1) ?? "");
		}
		if (args.includes("rev-parse")) {
			return Promise.resolve({ code: 1, stderr: "", stdout: "" });
		}
		return Promise.resolve({ code: 0, stderr: "", stdout: "" });
	};
	return {
		cloned,
		commands,
		deps: {
			basePath: BASE,
			exec,
			exists: (path: string) => Promise.resolve(cloned.has(path)),
			lock: noopLock(),
			mkdirRecursive: () => Promise.resolve(),
		},
	};
}

describe("prepareRepositoryRunWorkspace - full flow", () => {
	it("first task: clone + refspec + fetch, then an independent worktree", async () => {
		const world = orchestratorWorld();
		const path = await prepareRepositoryRunWorkspace(
			{ runId: RUN_ID, taskId: TASK_ID, workspace: REPOSITORY },
			world.deps
		);
		expect(path).toBe(WORKSPACE);
		expect(world.commands.map((args) => args.join(" "))).toEqual([
			`clone --bare ${REPOSITORY.cloneUrl} ${BARE_DIR}`,
			`--git-dir ${BARE_DIR} config remote.origin.fetch +refs/heads/*:refs/remotes/origin/*`,
			`--git-dir ${BARE_DIR} fetch origin main`,
			`--git-dir ${BARE_DIR} rev-parse --verify --quiet refs/heads/${BRANCH}`,
			`--git-dir ${BARE_DIR} worktree add ${WORKSPACE} -b ${BRANCH} origin/main`,
		]);
	});

	it("second task on the same repository: fetch only (no clone), its OWN worktree (§18.5)", async () => {
		const world = orchestratorWorld();
		await prepareRepositoryRunWorkspace(
			{ runId: RUN_ID, taskId: TASK_ID, workspace: REPOSITORY },
			world.deps
		);
		world.commands.length = 0;
		const secondTask = "7c3d2e00-0000-4000-8000-0000000task2";
		const secondRun = "b2e1f000-0000-4000-8000-00000000run2";
		const path = await prepareRepositoryRunWorkspace(
			{ runId: secondRun, taskId: secondTask, workspace: REPOSITORY },
			world.deps
		);
		expect(path).toBe(`/base/tasks/${secondTask}/repo`);
		expect(path).not.toBe(WORKSPACE);
		expect(world.commands.map((args) => args.join(" "))).toEqual([
			`--git-dir ${BARE_DIR} fetch origin main`,
			`--git-dir ${BARE_DIR} rev-parse --verify --quiet refs/heads/task/b2e1f000`,
			`--git-dir ${BARE_DIR} worktree add /base/tasks/${secondTask}/repo -b task/b2e1f000 origin/main`,
		]);
	});
});

describe("prepareRepositoryRunWorkspace - retry", () => {
	it("retry of the same task run: the worktree and branch are reused without error", async () => {
		const world = orchestratorWorld();
		const worktrees = new Set<string>();
		world.deps.exists = (path: string) =>
			Promise.resolve(world.cloned.has(path) || worktrees.has(path));
		const command = { runId: RUN_ID, taskId: TASK_ID, workspace: REPOSITORY };
		const first = await prepareRepositoryRunWorkspace(command, world.deps);
		worktrees.add(`${first}/.git`);
		const second = await prepareRepositoryRunWorkspace(command, world.deps);
		expect(second).toBe(first);
		// No second worktree add for the same task.
		const adds = world.commands.filter((args) => args.includes("worktree"));
		expect(adds).toHaveLength(1);
	});
});
