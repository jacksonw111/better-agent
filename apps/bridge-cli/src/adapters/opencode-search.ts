// P4-T5: opencode's cross-session content search — a read-only LIKE query
// against the same SQLite store opencode-sessions.ts lists from (VERIFIED on
// a real install: `part` rows carry `{type:"text", text}` JSON in `data`,
// joined to `message` for the role and `session` for title/directory). The
// user's query travels as an ESCAPEd LIKE parameter (never interpolated), and
// the JS re-check below keeps matching semantics identical to the JSONL
// providers (case-insensitive literal substring).

import { asString, isRecord } from "../normalize/types";
import {
	dbFileExists,
	loadDatabaseSync,
	opencodeDbPath,
	type SqliteDatabase,
} from "./opencode-sessions";
import type { EventSink } from "./session-history-files";
import {
	buildSnippet,
	makeSearchSessions,
	SEARCH_SESSION_CAP,
	SEARCH_SNIPPET_CAP,
	type SessionSearchHit,
	type SessionSearchOutcome,
} from "./session-search";

/** Bound on matching part rows fetched per search; hitting it marks the
 * outcome `partial` (older matches exist beyond the window). */
const PART_ROW_CAP = 400;

const LIKE_SPECIALS = /[\\%_]/g;

/** Escapes `\`, `%` and `_` so the user's query is a LITERAL `LIKE` needle. */
export function escapeLikePattern(query: string): string {
	return query.replace(LIKE_SPECIALS, (char) => `\\${char}`);
}

/** Newest sessions first, chronological parts within each — top-level,
 * non-archived sessions of this project dir only (same predicates as
 * opencode-sessions.ts's SESSION_QUERY). */
const SEARCH_QUERY = `SELECT s.id AS id, s.title AS title, s.directory AS directory,
		s.time_updated AS time_updated, m.data AS message_data, p.data AS part_data
	FROM part p
	JOIN session s ON s.id = p.session_id
	JOIN message m ON m.id = p.message_id
	WHERE s.directory = ? AND s.parent_id IS NULL AND s.time_archived IS NULL
		AND p.data LIKE ? ESCAPE '\\'
	ORDER BY s.time_updated DESC, p.time_created ASC LIMIT ${PART_ROW_CAP}`;

/** Fallback for an older schema without `parent_id`/`time_archived` —
 * mirrors opencode-sessions.ts's SESSION_QUERY_LOOSE. */
const SEARCH_QUERY_LOOSE = `SELECT s.id AS id, s.title AS title, s.directory AS directory,
		s.time_updated AS time_updated, m.data AS message_data, p.data AS part_data
	FROM part p
	JOIN session s ON s.id = p.session_id
	JOIN message m ON m.id = p.message_id
	WHERE s.directory = ? AND p.data LIKE ? ESCAPE '\\'
	ORDER BY s.time_updated DESC, p.time_created ASC LIMIT ${PART_ROW_CAP}`;

function queryPartRows(
	db: SqliteDatabase,
	dir: string,
	pattern: string
): unknown[] {
	try {
		return db.prepare(SEARCH_QUERY).all(dir, pattern);
	} catch {
		return db.prepare(SEARCH_QUERY_LOOSE).all(dir, pattern);
	}
}

/** The matched text of one part row (`{type:"text", text}` JSON), or
 * undefined for tool/file/other part kinds the LIKE may have grazed. */
function partText(partData: unknown): string | undefined {
	if (typeof partData !== "string") {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(partData);
	} catch {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	if (isRecord(parsed) && parsed.type === "text") {
		return asString(parsed.text);
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** `role` off the joined message row's `data` JSON. */
function messageRole(messageData: unknown): string | undefined {
	if (typeof messageData !== "string") {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(messageData);
		return isRecord(parsed) ? asString(parsed.role) : undefined;
	} catch {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
}

/** Folds one part row into its session's hit (creating it on first match),
 * respecting the per-session snippet cap and the session cap. */
function addRow(
	hits: Map<string, SessionSearchHit>,
	row: Record<string, unknown>,
	query: string
): void {
	const id = asString(row.id);
	const text = partText(row.part_data);
	const snippet = text === undefined ? undefined : buildSnippet(text, query);
	if (id === undefined || snippet === undefined) {
		return;
	}
	const existing = hits.get(id);
	if (existing) {
		if (existing.snippets.length < SEARCH_SNIPPET_CAP) {
			existing.snippets.push(snippetEntry(row, snippet));
		}
		return;
	}
	if (hits.size >= SEARCH_SESSION_CAP) {
		return;
	}
	hits.set(id, {
		cwd: asString(row.directory),
		id,
		lastModified: typeof row.time_updated === "number" ? row.time_updated : 0,
		snippets: [snippetEntry(row, snippet)],
		title: asString(row.title) ?? id,
	});
}

function snippetEntry(
	row: Record<string, unknown>,
	text: string
): { role?: string; text: string } {
	const role = messageRole(row.message_data);
	return role === undefined ? { text } : { role, text };
}

/** Searches this project directory's opencode sessions for `query` (literal,
 * case-insensitive). A missing DB is just "nothing recorded yet"; a runtime
 * without `node:sqlite` throws (makeSearchSessions turns that into the error
 * reply). */
export async function searchOpencodeSessions(
	dir: string,
	query: string,
	dbPath: string = opencodeDbPath()
): Promise<SessionSearchOutcome> {
	if (!(await dbFileExists(dbPath))) {
		return { partial: false, results: [] };
	}
	const DatabaseSync = await loadDatabaseSync();
	if (DatabaseSync === undefined) {
		throw new Error(
			"node:sqlite is unavailable in this runtime — cannot search opencode's session store"
		);
	}
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = queryPartRows(db, dir, `%${escapeLikePattern(query)}%`);
		const hits = new Map<string, SessionSearchHit>();
		for (const row of rows) {
			if (isRecord(row)) {
				addRow(hits, row, query);
			}
		}
		return {
			partial: rows.length >= PART_ROW_CAP,
			results: [...hits.values()],
		};
	} finally {
		db.close();
	}
}

/** opencode `AgentHandle.searchSessions` (both transports read the same
 * store) — fire-and-forget, mirroring makeOpencodeListSessions. */
export function makeOpencodeSearchSessions(
	dir: string,
	events: EventSink,
	dbPath?: string
): (requestId: string, query: string) => void {
	return makeSearchSessions(events, (query) =>
		searchOpencodeSessions(dir, query, dbPath)
	);
}
