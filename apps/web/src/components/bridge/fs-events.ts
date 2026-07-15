// P4-T3: wire shapes for the read-only fs channel's replies. The CLI's
// fs-reader.ts answers `fsList`/`fsRead` control commands with `fs_list`/
// `fs_read` STATUS events whose detail echoes the web-minted `requestId` —
// parsed here (lightly: trusted same-origin CLI wire, like `session_ready`'s
// capabilities) and correlated back to callers by fs-correlation.ts. Unknown
// status kinds are invisible to the chat feed's fold, so these never render
// as chat noise.

export const FS_LIST_STATUS = "fs_list";
export const FS_READ_STATUS = "fs_read";

/** One directory entry — mirrors the CLI's `FsEntry` (fs-reader.ts). */
export interface FsEntry {
	name: string;
	/** Bytes, files only (best-effort). */
	size?: number;
	type: "dir" | "file";
}

/** An `fs_list` reply: either `entries` or `error`, always `requestId`. */
export interface FsListDetail {
	entries?: FsEntry[];
	error?: string;
	path?: string;
	requestId: string;
	truncated?: boolean;
}

/** One `fs_read` reply event — a content chunk (`chunkIndex`/`totalChunks`/
 * `done`), a `binary: true` marker, or an `error`, always `requestId`. */
export interface FsReadDetail {
	binary?: boolean;
	chunkIndex?: number;
	content?: string;
	done?: boolean;
	error?: string;
	path?: string;
	requestId: string;
	size?: number;
	totalChunks?: number;
	truncated?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFsEntry(value: unknown): value is FsEntry {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		(value.type === "dir" || value.type === "file")
	);
}

/** Validates an `fs_list` detail — `null` unless it carries the string
 * `requestId` correlation key; malformed entries are dropped, not fatal. */
export function parseFsListDetail(detail: unknown): FsListDetail | null {
	if (!(isRecord(detail) && typeof detail.requestId === "string")) {
		return null;
	}
	const entries = Array.isArray(detail.entries)
		? detail.entries.filter(isFsEntry)
		: undefined;
	return {
		entries,
		error: typeof detail.error === "string" ? detail.error : undefined,
		path: typeof detail.path === "string" ? detail.path : undefined,
		requestId: detail.requestId,
		truncated: detail.truncated === true,
	};
}

/** Validates an `fs_read` detail — same `requestId` gate as
 * `parseFsListDetail`; every other field is optional per reply shape. */
export function parseFsReadDetail(detail: unknown): FsReadDetail | null {
	if (!(isRecord(detail) && typeof detail.requestId === "string")) {
		return null;
	}
	return {
		binary: detail.binary === true,
		chunkIndex:
			typeof detail.chunkIndex === "number" ? detail.chunkIndex : undefined,
		content: typeof detail.content === "string" ? detail.content : undefined,
		done: detail.done === true,
		error: typeof detail.error === "string" ? detail.error : undefined,
		path: typeof detail.path === "string" ? detail.path : undefined,
		requestId: detail.requestId,
		size: typeof detail.size === "number" ? detail.size : undefined,
		totalChunks:
			typeof detail.totalChunks === "number" ? detail.totalChunks : undefined,
		truncated: detail.truncated === true,
	};
}
