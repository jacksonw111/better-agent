import type { StreamEvent } from "./bridge-events";
import {
	GIT_COMMIT_STATUS,
	GIT_DIFF_STATUS,
	GIT_STATUS_STATUS,
	type GitCommitResult,
	type GitDiffDetail,
	type GitDiffResult,
	type GitStatusResult,
	parseGitCommitDetail,
	parseGitDiffDetail,
	parseGitStatusDetail,
} from "./git-events";

// P4-T4: request/response correlation for the git channel — the fs pattern
// (fs-correlation.ts) applied to `gitStatus`/`gitDiff`/`gitCommit`: the web
// mints a `requestId`, sends it on the control command, and the CLI echoes it
// on the reply status events picked out of the feed here. `gitDiff` replies
// arrive as chunks reassembled by `chunkIndex` (same contract as fsRead);
// status/commit are single-reply. Pure module (no React) — use-git-channel.ts
// owns the hook wiring; the result shapes live in git-events.ts (300-line cap).

/** The control-command senders (SessionControls.gitStatus/gitDiff/gitCommit)
 * — requestId first, mirroring the CLI's `CommandSink` methods. */
export interface GitSender {
	commit: (requestId: string, message: string) => Promise<void>;
	diff: (requestId: string, path?: string) => Promise<void>;
	status: (requestId: string) => Promise<void>;
}

export interface GitCorrelator {
	commit: (message: string) => Promise<GitCommitResult>;
	diff: (path?: string) => Promise<GitDiffResult>;
	/** Rejects everything still pending — the publishing terminal unmounted. */
	dispose: () => void;
	/** Feed the NEW tail of the event feed (caller tracks the cursor). */
	ingest: (events: StreamEvent[]) => void;
	status: () => Promise<GitStatusResult>;
}

/** Same inactivity-timeout contract as fs-correlation.ts — re-armed on every
 * received diff chunk so a long multi-chunk diff never trips it mid-flow. */
export const GIT_REQUEST_TIMEOUT_MS = 10_000;

export const GIT_TIMEOUT_MESSAGE = "No reply from the CLI — try again.";
const DISPOSED_MESSAGE = "The session's git channel closed.";

interface Pending<T> {
	reject: (error: Error) => void;
	resolve: (value: T) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface DiffState {
	chunks: Map<number, string>;
	total: number | null;
	truncated: boolean;
}

type PendingDiff = Pending<GitDiffResult> & { state: DiffState };

interface Ctx {
	commits: Map<string, Pending<GitCommitResult>>;
	diffs: Map<string, PendingDiff>;
	statuses: Map<string, Pending<GitStatusResult>>;
	timeoutMs: number;
}

/** Removes and returns `requestId`'s pending entry (clearing its timer). */
function settle<T extends { timer: ReturnType<typeof setTimeout> }>(
	map: Map<string, T>,
	requestId: string
): T | undefined {
	const pending = map.get(requestId);
	if (pending) {
		map.delete(requestId);
		clearTimeout(pending.timer);
	}
	return pending;
}

/** The shared shape of every pending-request record — what `settle`,
 * `armTimer` and the map-wide rejections need to operate generically. */
interface PendingLike {
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

function armTimer<T extends PendingLike>(
	map: Map<string, T>,
	requestId: string,
	timeoutMs: number
): ReturnType<typeof setTimeout> {
	return setTimeout(() => {
		settle(map, requestId)?.reject(new Error(GIT_TIMEOUT_MESSAGE));
	}, timeoutMs);
}

function onStatusEvent(ctx: Ctx, detail: unknown): void {
	const parsed = parseGitStatusDetail(detail);
	const pending = parsed && settle(ctx.statuses, parsed.requestId);
	if (!(parsed && pending)) {
		return;
	}
	if (parsed.error !== undefined) {
		pending.reject(new Error(parsed.error));
		return;
	}
	pending.resolve({
		ahead: parsed.ahead,
		behind: parsed.behind,
		branch: parsed.branch ?? "",
		entries: parsed.entries ?? [],
		notARepo: parsed.notARepo === true,
		truncated: parsed.truncated === true,
	});
}

function onCommitEvent(ctx: Ctx, detail: unknown): void {
	const parsed = parseGitCommitDetail(detail);
	const pending = parsed && settle(ctx.commits, parsed.requestId);
	if (!(parsed && pending)) {
		return;
	}
	if (parsed.error !== undefined || parsed.ok !== true) {
		pending.reject(new Error(parsed.error ?? "Malformed git_commit reply"));
		return;
	}
	pending.resolve({ hash: parsed.hash });
}

/** Resolves the diff once every chunk is present; otherwise re-arms its
 * inactivity timer and keeps waiting (mirrors fs-correlation's `finishRead`). */
function finishDiff(ctx: Ctx, pending: PendingDiff, requestId: string): void {
	const { state } = pending;
	if (state.total === null || state.chunks.size < state.total) {
		clearTimeout(pending.timer);
		pending.timer = armTimer(ctx.diffs, requestId, ctx.timeoutMs);
		return;
	}
	settle(ctx.diffs, requestId)?.resolve({
		content: Array.from(
			{ length: state.total },
			(_, index) => state.chunks.get(index) ?? ""
		).join(""),
		truncated: state.truncated,
	});
}

function applyDiffChunk(state: DiffState, parsed: GitDiffDetail): void {
	if (parsed.chunkIndex !== undefined && parsed.content !== undefined) {
		state.chunks.set(parsed.chunkIndex, parsed.content);
	}
	state.total = parsed.totalChunks ?? state.total;
	state.truncated = state.truncated || parsed.truncated === true;
}

function onDiffEvent(ctx: Ctx, detail: unknown): void {
	const parsed = parseGitDiffDetail(detail);
	const pending = parsed && ctx.diffs.get(parsed.requestId);
	if (!(parsed && pending)) {
		return;
	}
	if (parsed.error !== undefined) {
		settle(ctx.diffs, parsed.requestId)?.reject(new Error(parsed.error));
		return;
	}
	applyDiffChunk(pending.state, parsed);
	finishDiff(ctx, pending, parsed.requestId);
}

function ingestInto(ctx: Ctx, events: StreamEvent[]): void {
	for (const { event } of events) {
		if (event.kind !== "status") {
			continue;
		}
		if (event.status === GIT_STATUS_STATUS) {
			onStatusEvent(ctx, event.detail);
		} else if (event.status === GIT_DIFF_STATUS) {
			onDiffEvent(ctx, event.detail);
		} else if (event.status === GIT_COMMIT_STATUS) {
			onCommitEvent(ctx, event.detail);
		}
	}
}

function rejectAll<T extends PendingLike>(map: Map<string, T>): void {
	for (const requestId of [...map.keys()]) {
		settle(map, requestId)?.reject(new Error(DISPOSED_MESSAGE));
	}
}

function disposeAll(ctx: Ctx): void {
	rejectAll(ctx.statuses);
	rejectAll(ctx.diffs);
	rejectAll(ctx.commits);
}

export interface CreateGitCorrelatorArgs {
	/** Injectable id mint for deterministic tests. */
	mintId?: () => string;
	send: GitSender;
	timeoutMs?: number;
}

/** Rejects the pending request when the control send itself fails — shared
 * by all three request kinds. */
function rejectOnSendFailure<T extends PendingLike>(
	map: Map<string, T>,
	requestId: string,
	send: Promise<void>
): void {
	send.catch(() => {
		settle(map, requestId)?.reject(new Error(GIT_TIMEOUT_MESSAGE));
	});
}

function startStatus(
	ctx: Ctx,
	send: GitSender,
	requestId: string
): Promise<GitStatusResult> {
	const promise = new Promise<GitStatusResult>((resolve, reject) => {
		ctx.statuses.set(requestId, {
			reject,
			resolve,
			timer: armTimer(ctx.statuses, requestId, ctx.timeoutMs),
		});
	});
	rejectOnSendFailure(ctx.statuses, requestId, send.status(requestId));
	return promise;
}

function startDiff(
	ctx: Ctx,
	send: GitSender,
	requestId: string,
	path?: string
): Promise<GitDiffResult> {
	const promise = new Promise<GitDiffResult>((resolve, reject) => {
		ctx.diffs.set(requestId, {
			reject,
			resolve,
			state: { chunks: new Map(), total: null, truncated: false },
			timer: armTimer(ctx.diffs, requestId, ctx.timeoutMs),
		});
	});
	rejectOnSendFailure(ctx.diffs, requestId, send.diff(requestId, path));
	return promise;
}

function startCommit(
	ctx: Ctx,
	send: GitSender,
	requestId: string,
	message: string
): Promise<GitCommitResult> {
	const promise = new Promise<GitCommitResult>((resolve, reject) => {
		ctx.commits.set(requestId, {
			reject,
			resolve,
			timer: armTimer(ctx.commits, requestId, ctx.timeoutMs),
		});
	});
	rejectOnSendFailure(ctx.commits, requestId, send.commit(requestId, message));
	return promise;
}

export function createGitCorrelator(
	args: CreateGitCorrelatorArgs
): GitCorrelator {
	const ctx: Ctx = {
		commits: new Map(),
		diffs: new Map(),
		statuses: new Map(),
		timeoutMs: args.timeoutMs ?? GIT_REQUEST_TIMEOUT_MS,
	};
	const mintId = args.mintId ?? (() => crypto.randomUUID());
	return {
		commit: (message) => startCommit(ctx, args.send, mintId(), message),
		diff: (path) => startDiff(ctx, args.send, mintId(), path),
		dispose: () => disposeAll(ctx),
		ingest: (events) => ingestInto(ctx, events),
		status: () => startStatus(ctx, args.send, mintId()),
	};
}
