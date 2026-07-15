import type { StreamEvent } from "./bridge-events";
import {
	FS_LIST_STATUS,
	FS_READ_STATUS,
	type FsEntry,
	type FsReadDetail,
	parseFsListDetail,
	parseFsReadDetail,
} from "./fs-events";

// P4-T3: request/response correlation for the fs channel. Unlike the
// fire-and-forget `listSessions`, `fsList`/`fsRead` calls need their reply
// matched back to the caller: the web mints a `requestId`, sends it on the
// control command, and the CLI echoes it on the `fs_list`/`fs_read` status
// events this correlator picks out of the feed. `fsRead` replies arrive as
// chunks (≤12KB content each, possibly out of order) reassembled by
// `chunkIndex` until all `totalChunks` are present. Pure module (no React) —
// use-fs-channel.ts owns the hook wiring. Helpers live at module level over a
// shared `Ctx` to keep every function under the max-lines gate.

export interface FsListResult {
	entries: FsEntry[];
	truncated: boolean;
}

export interface FsReadResult {
	binary: boolean;
	content: string;
	size?: number;
	truncated: boolean;
}

/** The control-command senders (SessionControls.fsList/fsRead) — requestId
 * first, mirroring the CLI's `CommandSink` methods. */
export interface FsSender {
	list: (requestId: string, path?: string) => Promise<void>;
	read: (requestId: string, path: string) => Promise<void>;
}

export interface FsCorrelator {
	/** Rejects everything still pending — the publishing terminal unmounted or
	 * switched sessions, so no reply can arrive anymore. */
	dispose: () => void;
	/** Feed the NEW tail of the event feed (caller tracks the cursor). */
	ingest: (events: StreamEvent[]) => void;
	list: (path?: string) => Promise<FsListResult>;
	read: (path: string) => Promise<FsReadResult>;
}

/** How long a request waits for its (next) reply event before rejecting —
 * re-armed on every received chunk so a long multi-chunk read never trips it
 * while data is still flowing. */
export const FS_REQUEST_TIMEOUT_MS = 10_000;

export const FS_TIMEOUT_MESSAGE = "No reply from the CLI — try again.";
const DISPOSED_MESSAGE = "The session's fs channel closed.";

interface Pending<T> {
	reject: (error: Error) => void;
	resolve: (value: T) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface ReadState {
	chunks: Map<number, string>;
	size?: number;
	total: number | null;
	truncated: boolean;
}

type PendingRead = Pending<FsReadResult> & { state: ReadState };

interface Ctx {
	lists: Map<string, Pending<FsListResult>>;
	reads: Map<string, PendingRead>;
	timeoutMs: number;
}

/** Removes and returns `requestId`'s pending entry (clearing its timer), or
 * `undefined` when it already settled/never existed. */
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

function armListTimer(
	ctx: Ctx,
	requestId: string
): ReturnType<typeof setTimeout> {
	return setTimeout(() => {
		settle(ctx.lists, requestId)?.reject(new Error(FS_TIMEOUT_MESSAGE));
	}, ctx.timeoutMs);
}

function armReadTimer(
	ctx: Ctx,
	requestId: string
): ReturnType<typeof setTimeout> {
	return setTimeout(() => {
		settle(ctx.reads, requestId)?.reject(new Error(FS_TIMEOUT_MESSAGE));
	}, ctx.timeoutMs);
}

function onListEvent(ctx: Ctx, detail: unknown): void {
	const parsed = parseFsListDetail(detail);
	const pending = parsed && settle(ctx.lists, parsed.requestId);
	if (!(parsed && pending)) {
		return;
	}
	if (parsed.error !== undefined || parsed.entries === undefined) {
		pending.reject(new Error(parsed.error ?? "Malformed fs_list reply"));
		return;
	}
	pending.resolve({
		entries: parsed.entries,
		truncated: parsed.truncated === true,
	});
}

/** Resolves the read once every chunk is present; otherwise re-arms its
 * inactivity timer and keeps waiting. */
function finishRead(ctx: Ctx, pending: PendingRead, requestId: string): void {
	const { state } = pending;
	if (state.total === null || state.chunks.size < state.total) {
		clearTimeout(pending.timer);
		pending.timer = armReadTimer(ctx, requestId);
		return;
	}
	settle(ctx.reads, requestId)?.resolve({
		binary: false,
		content: Array.from(
			{ length: state.total },
			(_, index) => state.chunks.get(index) ?? ""
		).join(""),
		size: state.size,
		truncated: state.truncated,
	});
}

/** Folds one chunk event's fields into the read's accumulating state — split
 * from `onReadEvent` to keep that function under the complexity gate. */
function applyChunk(state: ReadState, parsed: FsReadDetail): void {
	if (parsed.chunkIndex !== undefined && parsed.content !== undefined) {
		state.chunks.set(parsed.chunkIndex, parsed.content);
	}
	state.total = parsed.totalChunks ?? state.total;
	state.size = parsed.size ?? state.size;
	state.truncated = state.truncated || parsed.truncated === true;
}

function onReadEvent(ctx: Ctx, detail: unknown): void {
	const parsed = parseFsReadDetail(detail);
	const pending = parsed && ctx.reads.get(parsed.requestId);
	if (!(parsed && pending)) {
		return;
	}
	if (parsed.error !== undefined) {
		settle(ctx.reads, parsed.requestId)?.reject(new Error(parsed.error));
		return;
	}
	if (parsed.binary) {
		settle(ctx.reads, parsed.requestId)?.resolve({
			binary: true,
			content: "",
			size: parsed.size,
			truncated: false,
		});
		return;
	}
	applyChunk(pending.state, parsed);
	finishRead(ctx, pending, parsed.requestId);
}

function ingestInto(ctx: Ctx, events: StreamEvent[]): void {
	for (const { event } of events) {
		if (event.kind !== "status") {
			continue;
		}
		if (event.status === FS_LIST_STATUS) {
			onListEvent(ctx, event.detail);
		} else if (event.status === FS_READ_STATUS) {
			onReadEvent(ctx, event.detail);
		}
	}
}

function disposeAll(ctx: Ctx): void {
	for (const requestId of [...ctx.lists.keys()]) {
		settle(ctx.lists, requestId)?.reject(new Error(DISPOSED_MESSAGE));
	}
	for (const requestId of [...ctx.reads.keys()]) {
		settle(ctx.reads, requestId)?.reject(new Error(DISPOSED_MESSAGE));
	}
}

export interface CreateFsCorrelatorArgs {
	/** Injectable id mint for deterministic tests. */
	mintId?: () => string;
	send: FsSender;
	timeoutMs?: number;
}

function defaultMintId(): string {
	return crypto.randomUUID();
}

export function createFsCorrelator(args: CreateFsCorrelatorArgs): FsCorrelator {
	const ctx: Ctx = {
		lists: new Map(),
		reads: new Map(),
		timeoutMs: args.timeoutMs ?? FS_REQUEST_TIMEOUT_MS,
	};
	const mintId = args.mintId ?? defaultMintId;
	const list = (path?: string): Promise<FsListResult> => {
		const requestId = mintId();
		const promise = new Promise<FsListResult>((resolve, reject) => {
			ctx.lists.set(requestId, {
				reject,
				resolve,
				timer: armListTimer(ctx, requestId),
			});
		});
		args.send.list(requestId, path).catch(() => {
			settle(ctx.lists, requestId)?.reject(new Error(FS_TIMEOUT_MESSAGE));
		});
		return promise;
	};
	const read = (path: string): Promise<FsReadResult> => {
		const requestId = mintId();
		const promise = new Promise<FsReadResult>((resolve, reject) => {
			ctx.reads.set(requestId, {
				reject,
				resolve,
				state: { chunks: new Map(), total: null, truncated: false },
				timer: armReadTimer(ctx, requestId),
			});
		});
		args.send.read(requestId, path).catch(() => {
			settle(ctx.reads, requestId)?.reject(new Error(FS_TIMEOUT_MESSAGE));
		});
		return promise;
	};
	return {
		dispose: () => disposeAll(ctx),
		ingest: (events) => ingestInto(ctx, events),
		list,
		read,
	};
}
