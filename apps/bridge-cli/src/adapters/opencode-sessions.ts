// P4-T1: opencode's "Past conversations" — a read-only query against the
// SQLite store opencode keeps at `~/.local/share/opencode/opencode.db`
// (VERIFIED against a real install: a `session` table with `id`, `title`,
// `directory`, `time_updated` (epoch ms), `parent_id` (subagent child
// sessions), `time_archived`). Read via Node's built-in `node:sqlite`
// (DatabaseSync, read-only open) — loaded dynamically so a runtime without it
// (e.g. a bun-compiled binary, where only `bun:sqlite` exists) degrades to an
// empty list with an error detail instead of crashing at import time.

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { asString, isRecord } from "../normalize/types";
import {
	type EventSink,
	pushSessionList,
	pushSessionListError,
	SESSION_LIST_CAP,
	type SessionListItem,
	truncateTitle,
} from "./session-history-files";

/** The structural subset of `node:sqlite`'s DatabaseSync this module uses —
 * local (rather than the module's own types) so the code type-checks the same
 * whether or not the installed @types/node ships `node:sqlite` declarations.
 * Shared with opencode-search.ts (P4-T5), which reads the same store. */
export interface SqliteDatabase {
	close(): void;
	prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

type SqliteDatabaseCtor = new (
	path: string,
	options: { readOnly: boolean }
) => SqliteDatabase;

export async function loadDatabaseSync(): Promise<
	SqliteDatabaseCtor | undefined
> {
	try {
		const mod = (await import("node:sqlite")) as {
			DatabaseSync?: SqliteDatabaseCtor;
		};
		return mod.DatabaseSync;
	} catch {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
}

/** opencode stores under the XDG data dir (default `~/.local/share`, macOS
 * included — confirmed on a real install). */
export function opencodeDbPath(): string {
	const dataHome =
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(dataHome, "opencode", "opencode.db");
}

/** Top-level (non-subagent), non-archived sessions for one project dir. */
const SESSION_QUERY = `SELECT id, title, directory, time_updated FROM session
	WHERE directory = ? AND parent_id IS NULL AND time_archived IS NULL
	ORDER BY time_updated DESC LIMIT ${SESSION_LIST_CAP}`;

/** Fallback for an older schema without `parent_id`/`time_archived`. */
const SESSION_QUERY_LOOSE = `SELECT id, title, directory, time_updated FROM session
	WHERE directory = ? ORDER BY time_updated DESC LIMIT ${SESSION_LIST_CAP}`;

function querySessionRows(db: SqliteDatabase, dir: string): unknown[] {
	try {
		return db.prepare(SESSION_QUERY).all(dir);
	} catch {
		return db.prepare(SESSION_QUERY_LOOSE).all(dir);
	}
}

function toSessionListItem(row: unknown): SessionListItem | undefined {
	if (!isRecord(row)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const id = asString(row.id);
	if (id === undefined) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		cwd: asString(row.directory),
		id,
		lastModified: typeof row.time_updated === "number" ? row.time_updated : 0,
		title: truncateTitle(asString(row.title) ?? id),
	};
}

export async function dbFileExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/** Lists this project directory's opencode sessions from the on-disk DB,
 * newest-first, capped at `SESSION_LIST_CAP`. A missing DB file is the
 * "nothing recorded yet" case → empty list; a runtime without `node:sqlite`
 * throws (callers turn that into the error-detail reply). */
export async function collectOpencodeSessions(
	dir: string,
	dbPath: string = opencodeDbPath()
): Promise<SessionListItem[]> {
	if (!(await dbFileExists(dbPath))) {
		return [];
	}
	const DatabaseSync = await loadDatabaseSync();
	if (DatabaseSync === undefined) {
		throw new Error(
			"node:sqlite is unavailable in this runtime — cannot read opencode's session store"
		);
	}
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const items: SessionListItem[] = [];
		for (const row of querySessionRows(db, dir)) {
			const item = toSessionListItem(row);
			if (item) {
				items.push(item);
			}
		}
		return items;
	} finally {
		db.close();
	}
}

/** Builds the opencode `AgentHandle.listSessions` (both transports — ACP and
 * serve read the same store) — fire-and-forget; any failure becomes an empty
 * `session_list` with an error detail, never a thrown error. */
export function makeOpencodeListSessions(
	dir: string,
	events: EventSink,
	dbPath?: string
): () => void {
	return () => {
		collectOpencodeSessions(dir, dbPath)
			.then((sessions) => pushSessionList(events, sessions))
			.catch((error: unknown) => pushSessionListError(events, error));
	};
}
