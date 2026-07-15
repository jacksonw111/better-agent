// P4-T4: wire shapes for the git channel's replies. The CLI's git-runner.ts
// answers `gitStatus`/`gitDiff`/`gitCommit` control commands with `git_status`/
// `git_diff`/`git_commit` STATUS events whose detail echoes the web-minted
// `requestId` — parsed here (lightly: trusted same-origin CLI wire, like
// fs-events.ts) and correlated back to callers by git-correlation.ts.

export const GIT_STATUS_STATUS = "git_status";
export const GIT_DIFF_STATUS = "git_diff";
export const GIT_COMMIT_STATUS = "git_commit";

/** One changed file — mirrors the CLI's `GitStatusEntry` (git-porcelain.ts):
 * `x` is the staged (index) status char, `y` the worktree one; `?`/`?` =
 * untracked; a rename keeps its source as `origPath`. */
export interface GitStatusEntry {
	origPath?: string;
	path: string;
	x: string;
	y: string;
}

/** A `git_status` reply: `entries` + `branch`, or `notARepo`, or `error` —
 * always `requestId`. */
export interface GitStatusDetail {
	ahead?: number;
	behind?: number;
	branch?: string;
	entries?: GitStatusEntry[];
	error?: string;
	notARepo?: boolean;
	requestId: string;
	truncated?: boolean;
}

/** One `git_diff` reply event — a content chunk (`chunkIndex`/`totalChunks`/
 * `done`) or an `error`, always `requestId`. */
export interface GitDiffDetail {
	chunkIndex?: number;
	content?: string;
	done?: boolean;
	error?: string;
	requestId: string;
	totalChunks?: number;
	truncated?: boolean;
}

/** A `git_commit` reply: `{ ok, hash }` or `{ error }`, always `requestId`. */
export interface GitCommitDetail {
	error?: string;
	hash?: string;
	ok?: boolean;
	requestId: string;
}

// The resolved (caller-facing) result shapes for the three requests — used by
// git-correlation.ts's promises and the GitChannel the Git pane consumes.
// Housed here rather than in git-correlation.ts for that file's 300-line cap.

export interface GitStatusResult {
	ahead?: number;
	behind?: number;
	branch: string;
	entries: GitStatusEntry[];
	notARepo: boolean;
	truncated: boolean;
}

export interface GitDiffResult {
	content: string;
	truncated: boolean;
}

export interface GitCommitResult {
	hash?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGitStatusEntry(value: unknown): value is GitStatusEntry {
	return (
		isRecord(value) &&
		typeof value.path === "string" &&
		typeof value.x === "string" &&
		typeof value.y === "string"
	);
}

/** Validates a `git_status` detail — `null` unless it carries the string
 * `requestId` correlation key; malformed entries are dropped, not fatal. */
export function parseGitStatusDetail(detail: unknown): GitStatusDetail | null {
	if (!(isRecord(detail) && typeof detail.requestId === "string")) {
		return null;
	}
	return {
		ahead: typeof detail.ahead === "number" ? detail.ahead : undefined,
		behind: typeof detail.behind === "number" ? detail.behind : undefined,
		branch: typeof detail.branch === "string" ? detail.branch : undefined,
		entries: Array.isArray(detail.entries)
			? detail.entries.filter(isGitStatusEntry)
			: undefined,
		error: typeof detail.error === "string" ? detail.error : undefined,
		notARepo: detail.notARepo === true,
		requestId: detail.requestId,
		truncated: detail.truncated === true,
	};
}

/** Validates a `git_diff` detail — same `requestId` gate. */
export function parseGitDiffDetail(detail: unknown): GitDiffDetail | null {
	if (!(isRecord(detail) && typeof detail.requestId === "string")) {
		return null;
	}
	return {
		chunkIndex:
			typeof detail.chunkIndex === "number" ? detail.chunkIndex : undefined,
		content: typeof detail.content === "string" ? detail.content : undefined,
		done: detail.done === true,
		error: typeof detail.error === "string" ? detail.error : undefined,
		requestId: detail.requestId,
		totalChunks:
			typeof detail.totalChunks === "number" ? detail.totalChunks : undefined,
		truncated: detail.truncated === true,
	};
}

/** Validates a `git_commit` detail — same `requestId` gate. */
export function parseGitCommitDetail(detail: unknown): GitCommitDetail | null {
	if (!(isRecord(detail) && typeof detail.requestId === "string")) {
		return null;
	}
	return {
		error: typeof detail.error === "string" ? detail.error : undefined,
		hash: typeof detail.hash === "string" ? detail.hash : undefined,
		ok: detail.ok === true,
		requestId: detail.requestId,
	};
}
