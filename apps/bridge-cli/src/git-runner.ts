// P4-T4: the CLI-GLOBAL minimal git channel. `gitStatus`/`gitDiff`/`gitCommit`
// control commands from the web (Git tab) are answered with `git_status`/
// `git_diff`/`git_commit` STATUS events echoing the web-minted `requestId` —
// same correlation contract as fs-reader.ts. Like the shell/fs wrappers this
// NEVER touches the agent: it's added to the `CommandSink` at restart-loop.ts's
// `wrapHandle` seam. Every git invocation is `execFile("git", argv)` with
// cwd = the validated workspace dir — user input (paths, the commit message)
// only ever travels as a single argv element, never through a shell. Stage/
// branch operations are explicitly phase 2; v1's commit stages EVERYTHING
// (`git add -A`) and the web UI says so on its button.

import { execFile } from "node:child_process";
import { chunkContent } from "./fs-reader";
import { type GitStatusEntry, parseStatusPorcelain } from "./git-porcelain";
import type { StatusEvent } from "./normalize/types";

export const GIT_STATUS_STATUS = "git_status";
export const GIT_DIFF_STATUS = "git_diff";
export const GIT_COMMIT_STATUS = "git_commit";

/** Wall-clock cap per git invocation; execFile kills the child on expiry
 * (SIGKILL) and the reply settles as an `{ error }` — never a hang. */
const GIT_TIMEOUT_MS = 30_000;
/** execFile stdout buffer bound — comfortably above `MAX_DIFF_BYTES` so the
 * diff cap below (not a MAXBUFFER crash) is what a huge diff hits. */
const MAX_GIT_BUFFER = 4 * 1024 * 1024;
/** Hard cap on one `git_diff` reply's total text; anything larger is cut at
 * the last full line and the reply carries `truncated: true`. */
export const MAX_DIFF_BYTES = 512 * 1024;
/** Byte budget for the serialized `git_status` entries — same relay-cap
 * reasoning as fs-reader.ts's `MAX_LIST_DETAIL_BYTES`. */
const MAX_STATUS_DETAIL_BYTES = 24_000;
const HALF = 2;

export interface GitRunnerDeps {
	/** The workspace root git runs in (the CLI's validated `args.dir`). */
	dir: string;
	/** Best-effort push straight to the relay — same fire-and-forget contract
	 * as fs-reader.ts's `pushEvent`. */
	pushEvent: (event: unknown) => void;
	timeoutMs?: number;
}

function statusEvent(
	status: string,
	detail: Record<string, unknown>
): StatusEvent {
	return { detail, kind: "status", status };
}

/** Runs one git command (argv, never a shell string) in the workspace.
 * `okCodes` admits non-zero exits that still mean success-with-output
 * (`git diff --no-index` exits 1 when the files differ). */
function runGit(
	deps: GitRunnerDeps,
	args: string[],
	okCodes: number[] = [0]
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			args,
			{
				cwd: deps.dir,
				killSignal: "SIGKILL",
				maxBuffer: MAX_GIT_BUFFER,
				timeout: deps.timeoutMs ?? GIT_TIMEOUT_MS,
			},
			(error, stdout, stderr) => {
				const code = (error as { code?: unknown } | null)?.code;
				if (error && !(typeof code === "number" && okCodes.includes(code))) {
					reject(new Error(stderr.trim() || error.message));
				} else {
					resolve(stdout);
				}
			}
		);
	});
}

async function isInsideWorkTree(deps: GitRunnerDeps): Promise<boolean> {
	let inside = false;
	try {
		const out = await runGit(deps, ["rev-parse", "--is-inside-work-tree"]);
		inside = out.trim() === "true";
	} catch {
		inside = false;
	}
	return inside;
}

/** Halves the entries list until its serialized size fits the detail budget —
 * mirrors fs-reader.ts's `fitEntries`, same relay-cap reasoning. */
function fitEntries(entries: GitStatusEntry[]): {
	entries: GitStatusEntry[];
	shrunk: boolean;
} {
	let fitted = entries;
	while (
		fitted.length > 1 &&
		Buffer.byteLength(JSON.stringify(fitted), "utf8") > MAX_STATUS_DETAIL_BYTES
	) {
		fitted = fitted.slice(0, Math.floor(fitted.length / HALF));
	}
	return { entries: fitted, shrunk: fitted.length !== entries.length };
}

async function runStatus(
	deps: GitRunnerDeps,
	requestId: string
): Promise<void> {
	if (!(await isInsideWorkTree(deps))) {
		deps.pushEvent(
			statusEvent(GIT_STATUS_STATUS, { notARepo: true, requestId })
		);
		return;
	}
	const out = await runGit(deps, ["status", "--porcelain=v1", "-b"]);
	const summary = parseStatusPorcelain(out);
	const fitted = fitEntries(summary.entries);
	deps.pushEvent(
		statusEvent(GIT_STATUS_STATUS, {
			ahead: summary.ahead,
			behind: summary.behind,
			branch: summary.branch,
			entries: fitted.entries,
			requestId,
			truncated: summary.truncated || fitted.shrunk,
		})
	);
}

/** Cuts `text` to at most `MAX_DIFF_BYTES`, at the last full line so no chunk
 * ever carries a torn multi-byte character or half a diff line. */
function capDiffText(text: string): { text: string; truncated: boolean } {
	if (Buffer.byteLength(text, "utf8") <= MAX_DIFF_BYTES) {
		return { text, truncated: false };
	}
	const head = Buffer.from(text, "utf8")
		.subarray(0, MAX_DIFF_BYTES)
		.toString("utf8");
	const lastNewline = head.lastIndexOf("\n");
	return {
		text: lastNewline === -1 ? head : head.slice(0, lastNewline + 1),
		truncated: true,
	};
}

/** Staged + unstaged diffs concatenated under `=== 已暂存 ===`/`=== 未暂存 ===`
 * markers (the web's diff view styles `===` lines as meta). An untracked file
 * requested by path has no `git diff` output at all, so it falls back to
 * `git diff --no-index /dev/null <path>` under a `=== 未跟踪 ===` marker. */
async function collectDiffText(
	deps: GitRunnerDeps,
	path?: string
): Promise<string> {
	const pathArgs = path === undefined ? [] : ["--", path];
	const staged = await runGit(deps, ["diff", "--cached", ...pathArgs]);
	const unstaged = await runGit(deps, ["diff", ...pathArgs]);
	const sections: string[] = [];
	if (staged !== "") {
		sections.push(`=== 已暂存 ===\n${staged}`);
	}
	if (unstaged !== "") {
		sections.push(`=== 未暂存 ===\n${unstaged}`);
	}
	if (sections.length === 0 && path !== undefined) {
		const untracked = await runGit(
			deps,
			["diff", "--no-index", "--", "/dev/null", path],
			[0, 1]
		).catch(() => "");
		if (untracked !== "") {
			sections.push(`=== 未跟踪 ===\n${untracked}`);
		}
	}
	return sections.join("\n");
}

async function runDiff(
	deps: GitRunnerDeps,
	requestId: string,
	path?: string
): Promise<void> {
	const collected = await collectDiffText(deps, path);
	const { text, truncated } = capDiffText(collected);
	const chunks = chunkContent(text);
	for (const [chunkIndex, content] of chunks.entries()) {
		deps.pushEvent(
			statusEvent(GIT_DIFF_STATUS, {
				chunkIndex,
				content,
				done: chunkIndex === chunks.length - 1,
				path,
				requestId,
				totalChunks: chunks.length,
				truncated,
			})
		);
	}
}

async function runCommit(
	deps: GitRunnerDeps,
	requestId: string,
	message: string
): Promise<void> {
	if (message.trim() === "") {
		throw new Error("empty commit message");
	}
	const pending = await runGit(deps, ["status", "--porcelain"]);
	if (pending.trim() === "") {
		throw new Error("nothing to commit");
	}
	await runGit(deps, ["add", "-A"]);
	await runGit(deps, ["commit", "-m", message]);
	const hash = (await runGit(deps, ["rev-parse", "--short", "HEAD"])).trim();
	deps.pushEvent(statusEvent(GIT_COMMIT_STATUS, { hash, ok: true, requestId }));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Creates the runner: each method runs async and settles by pushing its
 * reply (or an `{ error }` reply with the same requestId) — never by throwing
 * into the command dispatch. */
export function createGitRunner(deps: GitRunnerDeps): {
	commit: (requestId: string, message: string) => void;
	diff: (requestId: string, path?: string) => void;
	status: (requestId: string) => void;
} {
	const fail = (status: string, requestId: string) => (error: unknown) =>
		deps.pushEvent(
			statusEvent(status, { error: errorMessage(error), requestId })
		);
	return {
		commit: (requestId, message) => {
			runCommit(deps, requestId, message).catch(
				fail(GIT_COMMIT_STATUS, requestId)
			);
		},
		diff: (requestId, path) => {
			runDiff(deps, requestId, path).catch(fail(GIT_DIFF_STATUS, requestId));
		},
		status: (requestId) => {
			runStatus(deps, requestId).catch(fail(GIT_STATUS_STATUS, requestId));
		},
	};
}

/** Adds `gitStatus`/`gitDiff`/`gitCommit` to `handle` so the `CommandSink`
 * dispatch can route the web's git control commands here. Spreads (NOT
 * `Object.create`) for the same own-enumerable-property reason as
 * `withShellRunner` — see that function's doc comment in shell-runner.ts. */
export function withGitRunner<H extends object>(
	handle: H,
	deps: GitRunnerDeps
): H & {
	gitCommit(requestId: string, message: string): void;
	gitDiff(requestId: string, path?: string): void;
	gitStatus(requestId: string): void;
} {
	const runner = createGitRunner(deps);
	return {
		...handle,
		gitCommit: (requestId: string, message: string) =>
			runner.commit(requestId, message),
		gitDiff: (requestId: string, path?: string) => runner.diff(requestId, path),
		gitStatus: (requestId: string) => runner.status(requestId),
	};
}
