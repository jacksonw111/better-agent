// P4-T1: codex's "Past conversations" — an on-disk scan of the rollout JSONL
// logs `codex` writes under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
// (VERIFIED against real files on a codex 0.118 machine, matching what
// claudecodeui's sessions-watcher parses). Each line is
// `{timestamp, type, payload}`; the first line's `type: "session_meta"`
// carries `payload.id`/`payload.cwd`, and the first non-injected user
// `response_item` message is the best title. codex has no list RPC on the
// app-server wire this adapter drives, so disk is the source of truth.

import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
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

/** How many newest rollout files to examine per request — the scan filters by
 * cwd (a machine-wide store holds every project's sessions), so this bounds
 * the work when the target project's sessions are sparse among many others. */
const SCAN_FILE_CAP = 200;

/** Head bytes read per file: the `session_meta` line (which inlines the full
 * base_instructions text — routinely several KB) plus the first real user
 * message both live at the top; the injected AGENTS.md/user_instructions
 * blocks between them are what pushes this up to 128KB. */
const HEAD_BYTES = 131_072;

/** `sessions/` fans out as YYYY/MM/DD/…, i.e. files sit 3 levels below root;
 * one extra level of slack in case a future codex nests one deeper. */
const SESSIONS_DIR_DEPTH = 4;

/** `$CODEX_HOME` mirrors what codex itself honors for its state dir. */
export function codexSessionsRoot(): string {
	const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
	return join(home, "sessions");
}

interface CodexHeader {
	cwd?: string;
	id?: string;
}

function codexHeader(lines: unknown[]): CodexHeader | undefined {
	for (const line of lines) {
		if (
			isRecord(line) &&
			line.type === "session_meta" &&
			isRecord(line.payload)
		) {
			return {
				cwd: asString(line.payload.cwd),
				id: asString(line.payload.id),
			};
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** codex records its injected context (permissions/`<environment_context>`/
 * `<user_instructions>` wrappers, and the `# AGENTS.md instructions …` dump)
 * as ordinary user messages — none of them make a useful title. */
function isInjectedContext(text: string): boolean {
	return text.startsWith("<") || text.startsWith("# AGENTS.md");
}

function codexUserText(payload: Record<string, unknown>): string | undefined {
	const isUserMessage =
		payload.type === "message" &&
		payload.role === "user" &&
		Array.isArray(payload.content);
	if (!isUserMessage) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	for (const part of payload.content as unknown[]) {
		if (
			isRecord(part) &&
			part.type === "input_text" &&
			typeof part.text === "string" &&
			part.text.trim().length > 0 &&
			!isInjectedContext(part.text)
		) {
			return part.text;
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

function codexTitle(lines: unknown[]): string | undefined {
	for (const line of lines) {
		if (
			isRecord(line) &&
			line.type === "response_item" &&
			isRecord(line.payload)
		) {
			const text = codexUserText(line.payload);
			if (text !== undefined) {
				return text;
			}
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** Parses one rollout file's head into a picker item, or `undefined` when it
 * belongs to a different project (cwd mismatch), has no readable
 * `session_meta`, or can't be read at all — every such file is just skipped. */
async function codexItemFor(
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
	const header = codexHeader(lines);
	if (!(header?.id && header.cwd) || resolve(header.cwd) !== resolve(dir)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		cwd: header.cwd,
		id: header.id,
		lastModified: file.mtimeMs,
		title: truncateTitle(codexTitle(lines) ?? basename(file.path, ".jsonl")),
	};
}

/** Scans the newest rollout files (bounded — see `SCAN_FILE_CAP`) for this
 * project directory's sessions, newest-first, capped at `SESSION_LIST_CAP`. */
export async function collectCodexSessions(
	dir: string,
	root: string = codexSessionsRoot()
): Promise<SessionListItem[]> {
	const files = await newestFiles(root, {
		extension: ".jsonl",
		max: SCAN_FILE_CAP,
		maxDepth: SESSIONS_DIR_DEPTH,
	});
	const items: SessionListItem[] = [];
	for (const file of files) {
		if (items.length >= SESSION_LIST_CAP) {
			break;
		}
		const item = await codexItemFor(file, dir);
		if (item) {
			items.push(item);
		}
	}
	return items;
}

/** Builds the codex `AgentHandle.listSessions` — fire-and-forget like every
 * other adapter's (see claude-code-status.ts's `makeListSessions`); any
 * failure becomes an empty `session_list` with an error detail, never a
 * thrown error. */
export function makeCodexListSessions(
	dir: string,
	events: EventSink,
	root?: string
): () => void {
	return () => {
		collectCodexSessions(dir, root)
			.then((sessions) => pushSessionList(events, sessions))
			.catch((error: unknown) => pushSessionListError(events, error));
	};
}
