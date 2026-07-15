// P4-T1: pi's "Past conversations" — an on-disk scan of the `.jsonl` session
// logs pi writes under its sessionDir (VERIFIED against real files from a
// live pi install: one subdirectory per project — e.g.
// `~/.pi/agent/sessions/--Users-john-better-agent--/<timestamp>_<uuid>.jsonl`
// — each file starting with a `{type:"session", id, timestamp, cwd}` header
// line followed by `{type:"message", message:{role, content:[…]}}` entries).
// Rather than reverse-engineering the exact cwd→dirname escaping, the scan
// PREFERS the live session's own directory — pi's `get_state` reply carries
// `sessionFile`, whose dirname IS this project's session dir (see
// docs/research/agent-config-pi.md Table B) — and falls back to walking every
// project subdir under the root, filtering by each file's header `cwd`.

import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { asString, isRecord } from "../normalize/types";
import {
	type EventSink,
	type FileWithMtime,
	headJsonLines,
	newestFiles,
	pushSessionList,
	pushSessionListError,
	readFileHead,
	SESSION_LIST_CAP,
	type SessionListItem,
	truncateTitle,
} from "./session-history-files";

/** Bound on files examined per request — see codex-sessions.ts's twin. */
const SCAN_FILE_CAP = 200;

/** The header + first user message live at the top of the log; 128KB of head
 * covers even a long first prompt with room to spare. */
const HEAD_BYTES = 131_072;

/** Fallback root scan: root(0) → per-project dir(1) → files. Deliberately NOT
 * deeper — pi also creates a sibling directory per session (artifacts) whose
 * contents must not be mistaken for session logs. */
const ROOT_SCAN_DEPTH = 1;

/** Mirrors pi's own precedence for the sessions root: `--session-dir` isn't
 * passed by this adapter (see PI_ARGS in pi.ts), so env > default location
 * (`~/.pi/agent/sessions`, confirmed on a real install). */
export function piSessionsRoot(): string {
	return (
		process.env.PI_CODING_AGENT_SESSION_DIR ??
		join(homedir(), ".pi", "agent", "sessions")
	);
}

/** Captures the live session's directory off pi's `get_state` reply
 * (`data.sessionFile` — same response `makePiStatusTracker` reads model/
 * running from). pi.ts fires `get_state` once at start, so this is normally
 * known well before the user ever opens the picker. */
function capturePiSessionDir(raw: unknown, ref: { current?: string }): void {
	const isGetStateReply =
		isRecord(raw) &&
		raw.type === "response" &&
		raw.command === "get_state" &&
		raw.success === true;
	if (!isGetStateReply) {
		return;
	}
	const data = raw.data;
	if (
		isRecord(data) &&
		typeof data.sessionFile === "string" &&
		data.sessionFile.length > 0
	) {
		ref.current = dirname(data.sessionFile);
	}
}

interface PiHeader {
	cwd?: string;
	id?: string;
}

/** The first line's `{type:"session", id, cwd}` header. */
function piHeader(lines: unknown[]): PiHeader | undefined {
	const [first] = lines;
	if (isRecord(first) && first.type === "session") {
		return { cwd: asString(first.cwd), id: asString(first.id) };
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** The first non-empty `{type:"text"}` part of one user message's content.
 * Skips injected wrapper blocks (`<skill …>` etc. — pi records skill loads as
 * ordinary user messages, observed on a real install) so the title falls
 * through to the user's actual prompt, mirroring codex-sessions.ts's
 * `isInjectedContext`. */
function firstTextPart(content: unknown[]): string | undefined {
	for (const part of content) {
		if (
			isRecord(part) &&
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.trim().length > 0 &&
			!part.text.trimStart().startsWith("<")
		) {
			return part.text;
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** The first user message's text — pi has a `set_session_name` display name,
 * but it isn't recorded in the log's observed entry types (session/
 * model_change/thinking_level_change/message/custom_message), so the first
 * prompt is the best available title. */
function piTitle(lines: unknown[]): string | undefined {
	for (const line of lines) {
		if (
			!(isRecord(line) && line.type === "message" && isRecord(line.message))
		) {
			continue;
		}
		const { message } = line;
		if (message.role !== "user" || !Array.isArray(message.content)) {
			continue;
		}
		const text = firstTextPart(message.content as unknown[]);
		if (text !== undefined) {
			return text;
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

async function piItemFor(
	file: FileWithMtime,
	dir: string
): Promise<SessionListItem | undefined> {
	let lines: unknown[];
	try {
		lines = headJsonLines(await readFileHead(file.path, HEAD_BYTES));
	} catch {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const header = piHeader(lines);
	if (!(header?.id && header.cwd) || resolve(header.cwd) !== resolve(dir)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		cwd: header.cwd,
		id: header.id,
		lastModified: file.mtimeMs,
		title: truncateTitle(piTitle(lines) ?? basename(file.path, ".jsonl")),
	};
}

/** Newest session logs to examine: the live session's own dir when known
 * (exact, cheap), else every project subdir under the root — either way the
 * header `cwd` filter decides what's actually listed. */
async function piSessionFiles(
	sessionDir: string | undefined,
	root: string
): Promise<FileWithMtime[]> {
	if (sessionDir !== undefined) {
		const files = await newestFiles(sessionDir, {
			extension: ".jsonl",
			max: SCAN_FILE_CAP,
			maxDepth: 0,
		});
		if (files.length > 0) {
			return files;
		}
	}
	return await newestFiles(root, {
		extension: ".jsonl",
		max: SCAN_FILE_CAP,
		maxDepth: ROOT_SCAN_DEPTH,
	});
}

export async function collectPiSessions(
	dir: string,
	sessionDir: string | undefined,
	root: string = piSessionsRoot()
): Promise<SessionListItem[]> {
	const files = await piSessionFiles(sessionDir, root);
	const items: SessionListItem[] = [];
	for (const file of files) {
		if (items.length >= SESSION_LIST_CAP) {
			break;
		}
		const item = await piItemFor(file, dir);
		if (item) {
			items.push(item);
		}
	}
	return items;
}

/** The per-session tracker pi.ts wires in: `onLine` watches the stdout feed
 * for `get_state`'s sessionFile (see `capturePiSessionDir`), `listSessions`
 * answers the web's control command with a `session_list` status event —
 * fire-and-forget, errors degrade to an empty list (never a throw). */
export function makePiSessionIndex(
	dir: string,
	events: EventSink,
	root?: string
): { listSessions(): void; onLine(raw: unknown): void } {
	const sessionDirRef: { current?: string } = {};
	return {
		listSessions(): void {
			collectPiSessions(dir, sessionDirRef.current, root)
				.then((sessions) => pushSessionList(events, sessions))
				.catch((error: unknown) => pushSessionListError(events, error));
		},
		onLine(raw: unknown): void {
			capturePiSessionDir(raw, sessionDirRef);
		},
	};
}
