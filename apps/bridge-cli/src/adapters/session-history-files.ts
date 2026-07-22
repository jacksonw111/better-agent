// P4-T1: shared plumbing for the multi-provider "Past conversations" index —
// the on-disk session scanners (codex-sessions.ts / pi-sessions.ts /
// opencode-sessions.ts) all push the same `session_list` status event the
// claude adapter already emits (see claude-code-status.ts's
// `makeListSessions`), so the web's picker renders every provider's history
// through one parser (apps/web .../bridge-session-list.ts). This module holds
// the provider-agnostic pieces: the item shape, the payload caps, the
// bounded newest-first file scan, and the head-of-file JSONL reader.

import type { Dirent } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { NormalizedEvent } from "../normalize/types";

export interface EventSink {
	push(event: NormalizedEvent): void;
}

/** One "Past conversations" entry — mirrors the claude adapter's local
 * `SessionListItem` (claude-code-status.ts) and the web's parser copy in
 * `apps/web/src/components/bridge/bridge-session-list.ts`; keep in sync. */
export interface SessionListItem {
	cwd?: string;
	gitBranch?: string;
	id: string;
	lastModified: number;
	title: string;
}

/** Newest-N cap on the pushed list. 50 items × ~250 JSON bytes each sits
 * comfortably under the relay's `MAX_EVENT_BYTES` cap (see truncate-event.ts)
 * even with every title at `TITLE_MAX_CHARS`. */
export const SESSION_LIST_CAP = 50;

const TITLE_MAX_CHARS = 80;

const WHITESPACE_RUN = /\s+/g;

/** Collapses whitespace/newlines and caps the title so a pasted-wall-of-text
 * first prompt can't blow up the picker row (or the event size budget). */
export function truncateTitle(text: string): string {
	const oneLine = text.replaceAll(WHITESPACE_RUN, " ").trim();
	if (oneLine.length <= TITLE_MAX_CHARS) {
		return oneLine;
	}
	return `${oneLine.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/** The success reply — same shape `makeListSessions` (claude) pushes. */
export function pushSessionList(
	events: EventSink,
	sessions: SessionListItem[]
): void {
	events.push({
		kind: "status",
		status: "session_list",
		detail: { sessions: sessions.slice(0, SESSION_LIST_CAP) },
	});
}

/** The failure reply: still a `session_list` (so the web's popover settles on
 * its empty state instead of spinning), with the error carried as an extra
 * detail field the current parser ignores — never a thrown error. */
export function pushSessionListError(events: EventSink, error: unknown): void {
	events.push({
		kind: "status",
		status: "session_list",
		detail: {
			sessions: [],
			error: error instanceof Error ? error.message : String(error),
		},
	});
}

export interface FileWithMtime {
	mtimeMs: number;
	path: string;
}

/** Recursively collects `extension` files under `root` (descending at most
 * `maxDepth` directory levels below it), newest-mtime first, capped at `max`.
 * A missing/unreadable directory contributes nothing rather than throwing —
 * the "no sessions dir yet" case is just an empty list. */
export async function newestFiles(
	root: string,
	opts: { extension: string; max: number; maxDepth: number }
): Promise<FileWithMtime[]> {
	const found: FileWithMtime[] = [];
	await collectFilesInto(root, opts.maxDepth, opts.extension, found);
	found.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return found.slice(0, opts.max);
}

async function collectFilesInto(
	dir: string,
	depth: number,
	extension: string,
	found: FileWithMtime[]
): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	// Sequential on purpose: a bounded, shallow walk — parallelizing would only
	// complicate the error handling for no meaningful gain at these sizes.
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (depth > 0) {
				await collectFilesInto(full, depth - 1, extension, found);
			}
			continue;
		}
		if (!(entry.isFile() && entry.name.endsWith(extension))) {
			continue;
		}
		try {
			const stats = await stat(full);
			found.push({ mtimeMs: stats.mtimeMs, path: full });
		} catch {
			// raced deletion — skip
		}
	}
}

/** Reads at most `maxBytes` from the start of `path` — session logs can run
 * to megabytes, but everything the picker needs (the header line + the first
 * user message) lives at the top. */
export async function readFileHead(
	path: string,
	maxBytes: number
): Promise<string> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(maxBytes);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		return buffer.toString("utf8", 0, bytesRead);
	} finally {
		await handle.close();
	}
}

/** Parses a head-of-file chunk as JSONL, silently skipping malformed lines
 * (including the trailing line the byte cap may have cut mid-record). */
export function headJsonLines(text: string): unknown[] {
	const parsed: unknown[] = [];
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) {
			continue;
		}
		try {
			parsed.push(JSON.parse(line));
		} catch {
			// malformed / truncated line — skip
		}
	}
	return parsed;
}
