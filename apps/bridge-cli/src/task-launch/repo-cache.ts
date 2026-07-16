import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryWorkspaceIntent } from "@better-agent/agent/task-ports";
import { acquireRepoLock, type RepoLockDeps } from "./repo-lock";

// S4-T3 (design D5, master spec §6.16/§18.5): the per-Computer Repository
// Cache — ONE bare clone per repository identity at
// `<base>/cache/repos/<owner>__<repo>/`, shared by every Task on that
// repository. The first launch bare-clones; because `git clone --bare`
// creates neither remote-tracking refs nor a fetch refspec, the clone step
// also wires `remote.origin.fetch` and runs the initial fetch so
// `origin/<defaultBranch>` resolves for worktree creation AND later fetches
// actually update it. Subsequent launches only fetch the default branch —
// never a second full clone. clone/fetch run strictly under the cache file
// lock (repo-lock.ts). Git runs with the USER'S own credentials, never
// preflighted: any failure throws the REAL stderr (bounded) so the Run
// records the true cause (§16).

/** Wall-clock cap on one git invocation (clone of a big repo included). */
export const GIT_COMMAND_TIMEOUT_MS = 600_000;
/** Bound on how much git stderr one Run `errorMessage` carries. */
export const GIT_ERROR_MAX_CHARS = 2000;
/** execFile stdout/stderr buffer bound. */
const MAX_GIT_BUFFER = 4 * 1024 * 1024;
/** The refspec a plain `clone --bare` lacks — makes `origin/*` refs real. */
const ORIGIN_FETCH_REFSPEC = "+refs/heads/*:refs/remotes/origin/*";

export interface GitExecResult {
	/** Exit code; null when git never ran or was killed (timeout/spawn). */
	code: number | null;
	stderr: string;
	stdout: string;
}

/** The injectable git process seam: argv (never a shell string) → result.
 * Rejects only on harness-level failures; git failures resolve with a
 * non-zero `code` so callers can distinguish expected non-zero exits
 * (e.g. `rev-parse --verify` on a missing ref) from real errors. */
export type GitExec = (
	args: string[],
	options?: { cwd?: string }
) => Promise<GitExecResult>;

/** Production `GitExec`: `execFile("git", args)`, 10-minute cap. */
export function defaultGitExec(
	args: string[],
	options: { cwd?: string } = {}
): Promise<GitExecResult> {
	return new Promise((resolve) => {
		execFile(
			"git",
			args,
			{
				cwd: options.cwd,
				killSignal: "SIGKILL",
				maxBuffer: MAX_GIT_BUFFER,
				timeout: GIT_COMMAND_TIMEOUT_MS,
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ code: 0, stderr, stdout });
					return;
				}
				const code = (error as { code?: unknown }).code;
				resolve({
					code: typeof code === "number" ? code : null,
					stderr: stderr.trim() === "" ? error.message : stderr,
					stdout,
				});
			}
		);
	});
}

function gitSubcommand(args: string[]): string {
	return (args[0] === "--git-dir" ? args[2] : args[0]) ?? "git";
}

/** Runs one git command and throws the REAL (bounded) stderr on any
 * non-zero exit — never a swallowed or paraphrased error (§16). */
export async function runGit(
	exec: GitExec,
	args: string[],
	options?: { cwd?: string }
): Promise<string> {
	const result = await exec(args, options);
	if (result.code !== 0) {
		const detail = result.stderr.trim().slice(0, GIT_ERROR_MAX_CHARS);
		throw new Error(`git ${gitSubcommand(args)} failed: ${detail}`);
	}
	return result.stdout;
}

/** `<base>/cache/repos/<owner>__<repo>` — the repository's bare clone. */
export function repoCacheDir(basePath: string, fullName: string): string {
	return join(basePath, "cache", "repos", fullName.split("/").join("__"));
}

/** The cache lock file, next to (not inside) the bare clone directory. */
export function repoLockPath(basePath: string, fullName: string): string {
	return `${repoCacheDir(basePath, fullName)}.lock`;
}

async function defaultExists(path: string): Promise<boolean> {
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

async function defaultMkdirRecursive(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

export interface EnsureRepoCacheDeps {
	basePath: string;
	exec: GitExec;
	exists?: (path: string) => Promise<boolean>;
	lock?: RepoLockDeps;
	mkdirRecursive?: (path: string) => Promise<void>;
}

type CacheRepository = Pick<
	RepositoryWorkspaceIntent,
	"cloneUrl" | "defaultBranch" | "fullName"
>;

function fetchDefaultBranch(
	exec: GitExec,
	bareDir: string,
	repository: CacheRepository
): Promise<string> {
	return runGit(exec, [
		"--git-dir",
		bareDir,
		"fetch",
		"origin",
		repository.defaultBranch,
	]);
}

/** First launch: bare clone, then the remote-tracking refspec + initial
 * fetch a plain `clone --bare` lacks (see the module story above). */
async function cloneBareWithOriginRefs(
	exec: GitExec,
	bareDir: string,
	repository: CacheRepository
): Promise<void> {
	await runGit(exec, ["clone", "--bare", repository.cloneUrl, bareDir]);
	await runGit(exec, [
		"--git-dir",
		bareDir,
		"config",
		"remote.origin.fetch",
		ORIGIN_FETCH_REFSPEC,
	]);
	await fetchDefaultBranch(exec, bareDir, repository);
}

/**
 * Ensures the repository's bare cache exists and is synced, entirely under
 * the cache lock: missing → `clone --bare` + refspec + initial fetch;
 * present → `fetch origin <defaultBranch>`. Returns the bare directory.
 */
export async function ensureRepoCache(
	repository: CacheRepository,
	deps: EnsureRepoCacheDeps
): Promise<string> {
	const exists = deps.exists ?? defaultExists;
	const mkdirRecursive = deps.mkdirRecursive ?? defaultMkdirRecursive;
	const bareDir = repoCacheDir(deps.basePath, repository.fullName);
	await mkdirRecursive(join(deps.basePath, "cache", "repos"));
	const lock = await acquireRepoLock(
		repoLockPath(deps.basePath, repository.fullName),
		deps.lock
	);
	try {
		if (await exists(bareDir)) {
			await fetchDefaultBranch(deps.exec, bareDir, repository);
		} else {
			await cloneBareWithOriginRefs(deps.exec, bareDir, repository);
		}
	} finally {
		await lock.release();
	}
	return bareDir;
}
