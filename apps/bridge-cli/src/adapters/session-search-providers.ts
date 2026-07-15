// P4-T5: the JSONL providers behind cross-session search — how codex, pi and
// claude transcripts plug into session-search.ts's generic bounded scan. Line
// shapes mirror the P4-T1 list scanners (codex-sessions.ts / pi-sessions.ts —
// both VERIFIED against real stores) plus claude's `~/.claude/projects`
// transcripts (VERIFIED on a real install: one `<munged-cwd>/` dir per
// project, each line carrying `cwd`/`sessionId` alongside
// `{type:"user"|"assistant", message:{role, content}}`). opencode's SQLite
// store is different in kind and lives in opencode-search.ts.

import { homedir } from "node:os";
import { join } from "node:path";
import { asString, isRecord } from "../normalize/types";
import { codexSessionsRoot } from "./codex-sessions";
import { piSessionsRoot } from "./pi-sessions";
import {
	type EventSink,
	type FileWithMtime,
	newestFiles,
} from "./session-history-files";
import {
	makeSearchSessions,
	SEARCH_FILE_CAP,
	SEARCH_TIME_BOX_MS,
	type SessionSearchSnippet,
} from "./session-search";
import {
	type JsonlSearchFormat,
	searchJsonlTranscripts,
} from "./session-search-jsonl";

/** codex fans out as sessions/YYYY/MM/DD/… — same depth as codex-sessions.ts's
 * `SESSIONS_DIR_DEPTH` (kept in sync). */
const CODEX_DIR_DEPTH = 4;
/** pi: root(0) → per-project dir(1) — same as pi-sessions.ts's fallback. */
const PI_ROOT_DEPTH = 1;
/** claude: projects root(0) → per-project dir(1) → transcript files. */
const CLAUDE_ROOT_DEPTH = 1;

/** codex records injected context (permission/AGENTS.md wrappers) as ordinary
 * user messages — mirrors codex-sessions.ts's `isInjectedContext`; pi/claude
 * wrap theirs in `<...>` blocks too, so the same check filters all three. */
function isInjectedContext(text: string): boolean {
	return text.startsWith("<") || text.startsWith("# AGENTS.md");
}

/** Keeps a message text searchable unless it's an injected user-role wrapper
 * (assistant output is never injected context). */
function keepText(role: string | undefined, text: string): boolean {
	return (
		text.trim().length > 0 &&
		!(role === "user" && isInjectedContext(text.trimStart()))
	);
}

/** Collects `{type: <partType>, text}` parts of one content array. */
function textParts(
	content: unknown[],
	partTypes: readonly string[],
	role: string | undefined
): SessionSearchSnippet[] {
	const texts: SessionSearchSnippet[] = [];
	for (const part of content) {
		if (
			isRecord(part) &&
			typeof part.type === "string" &&
			partTypes.includes(part.type) &&
			typeof part.text === "string" &&
			keepText(role, part.text)
		) {
			texts.push(
				role === undefined ? { text: part.text } : { role, text: part.text }
			);
		}
	}
	return texts;
}

const CODEX_PART_TYPES = ["input_text", "output_text"] as const;

/** codex rollout `{type:"response_item", payload:{type:"message", role,
 * content:[{type:"input_text"|"output_text", text}]}}` lines. */
function codexMessageTexts(line: unknown): SessionSearchSnippet[] {
	if (
		!(isRecord(line) && line.type === "response_item" && isRecord(line.payload))
	) {
		return [];
	}
	const { payload } = line;
	const role = asString(payload.role);
	const isMessage =
		payload.type === "message" &&
		(role === "user" || role === "assistant") &&
		Array.isArray(payload.content);
	if (!isMessage) {
		return [];
	}
	return textParts(payload.content as unknown[], CODEX_PART_TYPES, role);
}

const codexFormat: JsonlSearchFormat = {
	header(line) {
		if (
			isRecord(line) &&
			line.type === "session_meta" &&
			isRecord(line.payload)
		) {
			return { cwd: asString(line.payload.cwd), id: asString(line.payload.id) };
		}
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	},
	texts: codexMessageTexts,
	title(line) {
		return codexMessageTexts(line).find((text) => text.role === "user")?.text;
	},
};

const PI_PART_TYPES = ["text"] as const;

/** pi `{type:"message", message:{role, content:[{type:"text", text}]}}` lines. */
function piMessageTexts(line: unknown): SessionSearchSnippet[] {
	if (!(isRecord(line) && line.type === "message" && isRecord(line.message))) {
		return [];
	}
	const { message } = line;
	const role = asString(message.role);
	if (
		!(
			(role === "user" || role === "assistant") &&
			Array.isArray(message.content)
		)
	) {
		return [];
	}
	return textParts(message.content as unknown[], PI_PART_TYPES, role);
}

const piFormat: JsonlSearchFormat = {
	header(line) {
		if (isRecord(line) && line.type === "session") {
			return { cwd: asString(line.cwd), id: asString(line.id) };
		}
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	},
	texts: piMessageTexts,
	title(line) {
		return piMessageTexts(line).find((text) => text.role === "user")?.text;
	},
};

/** claude transcript `{type:"user"|"assistant", message:{role, content}}`
 * lines — `content` is either a plain string (typed user prompts) or a parts
 * array with `{type:"text", text}` blocks. */
function claudeMessageTexts(line: unknown): SessionSearchSnippet[] {
	if (!(isRecord(line) && isRecord(line.message))) {
		return [];
	}
	const role =
		line.type === "user" || line.type === "assistant" ? line.type : undefined;
	if (role === undefined) {
		return [];
	}
	const { content } = line.message;
	if (typeof content === "string") {
		return keepText(role, content) ? [{ role, text: content }] : [];
	}
	if (Array.isArray(content)) {
		return textParts(content, PI_PART_TYPES, role);
	}
	return [];
}

const claudeFormat: JsonlSearchFormat = {
	header(line) {
		if (
			isRecord(line) &&
			typeof line.cwd === "string" &&
			typeof line.sessionId === "string"
		) {
			return { cwd: line.cwd, id: line.sessionId };
		}
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	},
	texts: claudeMessageTexts,
	title(line) {
		return claudeMessageTexts(line).find((text) => text.role === "user")?.text;
	},
};

/** claude keeps transcripts under `~/.claude/projects/<munged-cwd>/`. */
export function claudeProjectsRoot(): string {
	return join(homedir(), ".claude", "projects");
}

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;

/** claude's project-dir munge (`/Users/a/b` → `-Users-a-b`) — if the guess is
 * wrong the root-scan fallback still finds the files by their header `cwd`. */
function claudeProjectDirName(dir: string): string {
	return dir.replace(NON_ALPHANUMERIC, "-");
}

/** Prefers the exact per-project dir (cheap), falling back to a bounded scan
 * of every project's transcripts — the header cwd filter decides either way
 * (mirrors pi-sessions.ts's `piSessionFiles`). */
async function claudeTranscriptFiles(
	dir: string,
	root: string
): Promise<FileWithMtime[]> {
	const exact = await newestFiles(join(root, claudeProjectDirName(dir)), {
		extension: ".jsonl",
		max: SEARCH_FILE_CAP,
		maxDepth: 0,
	});
	if (exact.length > 0) {
		return exact;
	}
	return await newestFiles(root, {
		extension: ".jsonl",
		max: SEARCH_FILE_CAP,
		maxDepth: CLAUDE_ROOT_DEPTH,
	});
}

/** Wires one provider's discovery + format into the shared engine. */
function makeJsonlSearch(
	dir: string,
	events: EventSink,
	format: JsonlSearchFormat,
	files: () => Promise<FileWithMtime[]>
): (requestId: string, query: string) => void {
	return makeSearchSessions(
		events,
		async (query) =>
			await searchJsonlTranscripts({
				deadline: Date.now() + SEARCH_TIME_BOX_MS,
				dir,
				files: await files(),
				format,
				query,
			})
	);
}

/** codex `AgentHandle.searchSessions` — newest rollout logs, cwd-filtered. */
export function makeCodexSearchSessions(
	dir: string,
	events: EventSink,
	root: string = codexSessionsRoot()
): (requestId: string, query: string) => void {
	return makeJsonlSearch(dir, events, codexFormat, () =>
		newestFiles(root, {
			extension: ".jsonl",
			max: SEARCH_FILE_CAP,
			maxDepth: CODEX_DIR_DEPTH,
		})
	);
}

/** pi `AgentHandle.searchSessions` — every project subdir under the sessions
 * root (the per-file header cwd filter scopes it to this workspace). */
export function makePiSearchSessions(
	dir: string,
	events: EventSink,
	root: string = piSessionsRoot()
): (requestId: string, query: string) => void {
	return makeJsonlSearch(dir, events, piFormat, () =>
		newestFiles(root, {
			extension: ".jsonl",
			max: SEARCH_FILE_CAP,
			maxDepth: PI_ROOT_DEPTH,
		})
	);
}

/** claude `AgentHandle.searchSessions` — DISK-side (the Agent SDK has no
 * transcript-content search), reading the same `~/.claude/projects` files the
 * SDK's `listSessions` indexes. */
export function makeClaudeSearchSessions(
	dir: string,
	events: EventSink,
	root: string = claudeProjectsRoot()
): (requestId: string, query: string) => void {
	return makeJsonlSearch(dir, events, claudeFormat, () =>
		claudeTranscriptFiles(dir, root)
	);
}
