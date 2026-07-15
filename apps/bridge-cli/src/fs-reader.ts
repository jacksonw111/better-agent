// P4-T3: the CLI-GLOBAL read-only fs channel. `fsList`/`fsRead` control
// commands from the web (Files tab, composer @file picker) are answered with
// `fs_list`/`fs_read` STATUS events that echo the request's web-minted
// `requestId`, so the web can correlate each reply to its caller. Like
// shell-runner.ts this NEVER touches the agent — it's a wrapper added to the
// `CommandSink` at the same seam (restart-loop.ts's `wrapHandle`). Every path
// is confined to the workspace via workspace-path.ts, reads are size-capped
// and chunked under the relay's 32KB/event limit, and writes don't exist.

import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { StatusEvent } from "./normalize/types";
import { resolveWorkspacePath } from "./workspace-path";

export const FS_LIST_STATUS = "fs_list";
export const FS_READ_STATUS = "fs_read";

/** Max directory entries per `fs_list` reply — a huge node_modules-style dir
 * answers with the first 500 (dirs-first, alpha) and `truncated: true`. */
export const MAX_LIST_ENTRIES = 500;
/** Byte budget for the serialized entries list. 500 long names could still
 * push the whole event past the relay's 32KB cap, and `truncateEvent` would
 * then degrade the reply to an `event_truncated` status (losing the
 * requestId, hanging the web's request) — so the list is shrunk here first. */
const MAX_LIST_DETAIL_BYTES = 24_000;
/** Hard cap on bytes read from one file; anything larger is cut here and the
 * reply carries `truncated: true` so the preview can say so. */
export const MAX_READ_BYTES = 256 * 1024;
/** Per-chunk content byte budget — comfortably under the 32KB event cap even
 * with JSON-escaping overhead and the chunk's sibling fields. */
export const CHUNK_CONTENT_BYTES = 12_000;
/** Leading window sniffed for null bytes; any hit marks the file binary and
 * the reply carries `binary: true` with no content at all. */
const BINARY_SNIFF_BYTES = 8192;

export interface FsReaderDeps {
	/** The workspace root every path resolves against (the CLI's validated
	 * `args.dir`) — never the CLI's own cwd, never caller-supplied. */
	dir: string;
	/** Best-effort push of one normalized event straight to the relay — same
	 * fire-and-forget contract as shell-runner.ts's `pushEvent`. */
	pushEvent: (event: unknown) => void;
}

export interface FsEntry {
	name: string;
	/** Bytes, files only — best-effort (a stat failure just omits it). */
	size?: number;
	type: "dir" | "file";
}

function statusEvent(
	status: string,
	detail: Record<string, unknown>
): StatusEvent {
	return { detail, kind: "status", status };
}

function byteSize(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// Single valued exit (not an early `return undefined`) — biome's formatter
// rewrites `return undefined` to a bare `return`, which then trips eslint's
// consistent-return.
async function fileSize(filePath: string): Promise<number | undefined> {
	let size: number | undefined;
	try {
		size = (await stat(filePath)).size;
	} catch {
		size = undefined;
	}
	return size;
}

/** Reads `target`'s entries: dirs first, each half alpha-sorted, capped at
 * `MAX_LIST_ENTRIES`, file sizes stat'd only for the kept entries. A symlink
 * dirent is listed as a file (its type/size left to a follow-up read, which
 * is where the workspace-escape check bites anyway). */
async function listEntries(
	target: string
): Promise<{ entries: FsEntry[]; truncated: boolean }> {
	const dirents = await readdir(target, { withFileTypes: true });
	const dirs: FsEntry[] = [];
	const files: FsEntry[] = [];
	for (const dirent of dirents) {
		const type = dirent.isDirectory() ? "dir" : "file";
		(type === "dir" ? dirs : files).push({ name: dirent.name, type });
	}
	const byName = (a: FsEntry, b: FsEntry) => a.name.localeCompare(b.name);
	dirs.sort(byName);
	files.sort(byName);
	const all = [...dirs, ...files];
	const capped = all.slice(0, MAX_LIST_ENTRIES);
	await Promise.all(
		capped.map(async (entry) => {
			if (entry.type === "file") {
				entry.size = await fileSize(path.join(target, entry.name));
			}
		})
	);
	return { entries: capped, truncated: all.length > capped.length };
}

/** Halves an entries list until its serialized size fits the detail budget —
 * see `MAX_LIST_DETAIL_BYTES` for why this must happen before the push. */
function fitEntries(entries: FsEntry[]): {
	entries: FsEntry[];
	shrunk: boolean;
} {
	const half = 2;
	let fitted = entries;
	while (fitted.length > 1 && byteSize(fitted) > MAX_LIST_DETAIL_BYTES) {
		fitted = fitted.slice(0, Math.floor(fitted.length / half));
	}
	return { entries: fitted, shrunk: fitted.length !== entries.length };
}

async function runList(
	deps: FsReaderDeps,
	requestId: string,
	relPath: string
): Promise<void> {
	const target = await resolveWorkspacePath(deps.dir, relPath);
	const listed = await listEntries(target);
	const fitted = fitEntries(listed.entries);
	deps.pushEvent(
		statusEvent(FS_LIST_STATUS, {
			entries: fitted.entries,
			path: relPath,
			requestId,
			truncated: listed.truncated || fitted.shrunk,
		})
	);
}

/** Opens `target` and reads at most `MAX_READ_BYTES` from its head — never
 * `readFile`, which would pull an arbitrarily large file into memory first. */
async function readCapped(
	target: string
): Promise<{ buffer: Buffer; size: number }> {
	const info = await stat(target);
	if (info.isDirectory()) {
		throw new Error("path is a directory");
	}
	const length = Math.min(info.size, MAX_READ_BYTES);
	const handle = await open(target, "r");
	try {
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, 0);
		return { buffer, size: info.size };
	} finally {
		await handle.close();
	}
}

/** Splits `text` into wire chunks of at most `CHUNK_CONTENT_BYTES` UTF-8
 * bytes each. Sliced by code units then shrunk by halving while over-budget
 * (may under-fill a multi-byte-heavy chunk — harmless); a slice landing
 * mid-surrogate-pair round-trips through JSON intact and reassembles
 * correctly on plain concatenation. An empty file yields one empty chunk so
 * the reply still carries `done: true`. */
export function chunkContent(text: string): string[] {
	if (text.length === 0) {
		return [""];
	}
	const half = 2;
	const chunks: string[] = [];
	let index = 0;
	while (index < text.length) {
		let length = Math.min(text.length - index, CHUNK_CONTENT_BYTES);
		while (
			Buffer.byteLength(text.slice(index, index + length), "utf8") >
			CHUNK_CONTENT_BYTES
		) {
			length = Math.ceil(length / half);
		}
		chunks.push(text.slice(index, index + length));
		index += length;
	}
	return chunks;
}

async function runRead(
	deps: FsReaderDeps,
	requestId: string,
	relPath: string
): Promise<void> {
	const target = await resolveWorkspacePath(deps.dir, relPath);
	const { buffer, size } = await readCapped(target);
	const base = { path: relPath, requestId, size };
	if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
		deps.pushEvent(
			statusEvent(FS_READ_STATUS, {
				...base,
				binary: true,
				chunkIndex: 0,
				content: "",
				done: true,
				totalChunks: 1,
			})
		);
		return;
	}
	const chunks = chunkContent(buffer.toString("utf8"));
	for (const [chunkIndex, content] of chunks.entries()) {
		deps.pushEvent(
			statusEvent(FS_READ_STATUS, {
				...base,
				chunkIndex,
				content,
				done: chunkIndex === chunks.length - 1,
				totalChunks: chunks.length,
				truncated: size > MAX_READ_BYTES,
			})
		);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Creates the reader: `list`/`read` run async and settle by pushing their
 * reply (or an `{ error }` reply carrying the same requestId) — never by
 * throwing into the command dispatch. */
export function createFsReader(deps: FsReaderDeps): {
	list: (requestId: string, path?: string) => void;
	read: (requestId: string, path: string) => void;
} {
	const fail =
		(status: string, requestId: string, relPath: string) => (error: unknown) =>
			deps.pushEvent(
				statusEvent(status, {
					error: errorMessage(error),
					path: relPath,
					requestId,
				})
			);
	return {
		list: (requestId, relPath = "") => {
			runList(deps, requestId, relPath).catch(
				fail(FS_LIST_STATUS, requestId, relPath)
			);
		},
		read: (requestId, relPath) => {
			runRead(deps, requestId, relPath).catch(
				fail(FS_READ_STATUS, requestId, relPath)
			);
		},
	};
}

/** Adds `fsList`/`fsRead` to `handle` so the `CommandSink` dispatch can route
 * the web's fs control commands to the reader. Spreads (NOT `Object.create`)
 * for the same own-enumerable-property reason as `withShellRunner` — see that
 * function's doc comment in shell-runner.ts. */
export function withFsReader<H extends object>(
	handle: H,
	deps: FsReaderDeps
): H & {
	fsList(requestId: string, path?: string): void;
	fsRead(requestId: string, path: string): void;
} {
	const reader = createFsReader(deps);
	return {
		...handle,
		fsList: (requestId: string, relPath?: string) =>
			reader.list(requestId, relPath),
		fsRead: (requestId: string, relPath: string) =>
			reader.read(requestId, relPath),
	};
}
