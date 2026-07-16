import { homedir } from "node:os";
import { join } from "node:path";
import type { RepositoryWorkspaceIntent } from "@better-agent/agent/task-ports";
import {
	defaultGitExec,
	ensureRepoCache,
	type GitExec,
	runGit,
} from "./repo-cache";
import type { RepoLockDeps } from "./repo-lock";

// S4-T3 (design D5, master spec §6.17/§9.2/§18.5): the repository-backed Task
// Workspace — an independent writable `git worktree` off the shared bare
// cache, at `<base>/tasks/<taskId>/repo/` on branch `task/<runId[:8]>`.
// Different Tasks never share uncommitted modifications. Retries reuse: a
// still-valid worktree directory is returned as-is (uncommitted work
// survives), and an already-created task branch is checked out again (after
// `worktree prune` clears its stale registration) instead of erroring.
// `prepareRepositoryRunWorkspace` is the launch handler's repository branch:
// lock → clone-or-fetch the cache → release → worktree add — all during
// `preparing_workspace`, any git failure throwing the REAL stderr (§16).

/** How much of the runId names the task branch: `task/<runId[:8]>`. */
const RUN_BRANCH_ID_LENGTH = 8;

/** `<base>/tasks/<taskId>/repo` — the Task's worktree checkout. */
export function taskRepoWorkspaceDir(basePath: string, taskId: string): string {
	return join(basePath, "tasks", taskId, "repo");
}

/** The Run's development branch, `task/<first 8 chars of runId>` (§9.2). */
export function runBranchName(runId: string): string {
	return `task/${runId.slice(0, RUN_BRANCH_ID_LENGTH)}`;
}

async function defaultExists(path: string): Promise<boolean> {
	const { stat } = await import("node:fs/promises");
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as { code?: string } | null)?.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export interface RepoWorktreeIntent {
	defaultBranch: string;
	runId: string;
	taskId: string;
}

export interface RepoWorktreeDeps {
	/** The repository's bare cache directory (ensureRepoCache's result). */
	bareDir: string;
	basePath: string;
	exec: GitExec;
	exists?: (path: string) => Promise<boolean>;
}

/**
 * Creates (or reuses) the Task's worktree off the bare cache and returns its
 * absolute path. Fresh: `worktree add <path> -b task/<runId[:8]>
 * origin/<defaultBranch>`. Retry with the branch already created: prune stale
 * registrations, then `worktree add <path> <branch>`. Retry with the
 * directory still valid: reuse it untouched.
 */
export async function prepareRepoWorktree(
	intent: RepoWorktreeIntent,
	deps: RepoWorktreeDeps
): Promise<string> {
	const exists = deps.exists ?? defaultExists;
	const workspacePath = taskRepoWorkspaceDir(deps.basePath, intent.taskId);
	if (await exists(join(workspacePath, ".git"))) {
		return workspacePath; // A retry's still-valid worktree — reuse as-is.
	}
	const branch = runBranchName(intent.runId);
	const gitDir = ["--git-dir", deps.bareDir];
	// `rev-parse --verify` exits non-zero for a missing ref — that is the
	// answer, not an error; real git failures below still throw stderr.
	const branchProbe = await deps.exec([
		...gitDir,
		"rev-parse",
		"--verify",
		"--quiet",
		`refs/heads/${branch}`,
	]);
	if (branchProbe.code === 0) {
		// Retry: the branch exists but its worktree directory is gone. Clear
		// the stale registration, then check the SAME branch out again.
		await runGit(deps.exec, [...gitDir, "worktree", "prune"]);
		await runGit(deps.exec, [
			...gitDir,
			"worktree",
			"add",
			workspacePath,
			branch,
		]);
	} else {
		await runGit(deps.exec, [
			...gitDir,
			"worktree",
			"add",
			workspacePath,
			"-b",
			branch,
			`origin/${intent.defaultBranch}`,
		]);
	}
	return workspacePath;
}

export interface RepositoryLaunchIntent {
	runId: string;
	taskId: string;
	workspace: RepositoryWorkspaceIntent;
}

export interface PrepareRepositoryWorkspaceDeps {
	/** Managed root; defaults to `~/.better-agent`. */
	basePath?: string;
	exec?: GitExec;
	exists?: (path: string) => Promise<boolean>;
	lock?: RepoLockDeps;
	mkdirRecursive?: (path: string) => Promise<void>;
}

/**
 * The launch handler's repository branch (§9.2): take the cache lock, bare
 * clone or fetch the shared cache, release, then add this Task's own
 * worktree — returning the workspace path the Run starts in. Every git
 * failure propagates with the real stderr so the Run reports `failed` with
 * the true cause; nothing is preflighted (§16).
 */
export async function prepareRepositoryRunWorkspace(
	command: RepositoryLaunchIntent,
	deps: PrepareRepositoryWorkspaceDeps = {}
): Promise<string> {
	const basePath = deps.basePath ?? join(homedir(), ".better-agent");
	const exec = deps.exec ?? defaultGitExec;
	const bareDir = await ensureRepoCache(command.workspace, {
		basePath,
		exec,
		exists: deps.exists,
		lock: deps.lock,
		mkdirRecursive: deps.mkdirRecursive,
	});
	return prepareRepoWorktree(
		{
			defaultBranch: command.workspace.defaultBranch,
			runId: command.runId,
			taskId: command.taskId,
		},
		{ bareDir, basePath, exec, exists: deps.exists }
	);
}
