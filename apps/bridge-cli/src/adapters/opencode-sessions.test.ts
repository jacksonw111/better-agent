// P4-T1 specs for the opencode SQLite session reader (opencode-sessions.ts).
// Each test builds a tiny temp DB through the same `node:sqlite` module the
// implementation reads with; if the test runtime lacks node:sqlite the DB
// tests skip gracefully (the implementation itself degrades to an error
// detail in that case — covered by the corrupt-file test's shape either way).

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import {
	collectOpencodeSessions,
	makeOpencodeListSessions,
} from "./opencode-sessions";

const PROJECT_DIR = "/tmp/opencode-project";

interface TestSqlite {
	close(): void;
	exec(sql: string): void;
	prepare(sql: string): { run(...params: unknown[]): unknown };
}

const DatabaseSync = await (async (): Promise<
	(new (path: string) => TestSqlite) | undefined
> => {
	try {
		const mod = (await import("node:sqlite")) as unknown as {
			DatabaseSync: new (path: string) => TestSqlite;
		};
		return mod.DatabaseSync;
	} catch {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
})();

let roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true }))
	);
	roots = [];
});

async function makeDbPath(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "opencode-sessions-test-"));
	roots.push(root);
	return join(root, "opencode.db");
}

interface SessionRow {
	archived?: number;
	directory: string;
	id: string;
	parentId?: string;
	title: string;
	updated: number;
}

function seedDb(
	Ctor: new (path: string) => TestSqlite,
	path: string,
	rows: SessionRow[]
): void {
	const db = new Ctor(path);
	db.exec(
		`CREATE TABLE session (id text PRIMARY KEY, parent_id text,
			directory text NOT NULL, title text NOT NULL,
			time_updated integer NOT NULL, time_archived integer)`
	);
	const insert = db.prepare(
		"INSERT INTO session (id, parent_id, directory, title, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?)"
	);
	for (const row of rows) {
		insert.run(
			row.id,
			row.parentId ?? null,
			row.directory,
			row.title,
			row.updated,
			row.archived ?? null
		);
	}
	db.close();
}

it.skipIf(DatabaseSync === undefined)(
	"lists this directory's top-level, non-archived sessions newest-first",
	async () => {
		if (DatabaseSync === undefined) {
			return;
		}
		const dbPath = await makeDbPath();
		seedDb(DatabaseSync, dbPath, [
			{ id: "ses-old", directory: PROJECT_DIR, title: "older", updated: 100 },
			{ id: "ses-new", directory: PROJECT_DIR, title: "newer", updated: 200 },
			{
				id: "ses-other",
				directory: "/elsewhere",
				title: "not ours",
				updated: 300,
			},
			{
				id: "ses-child",
				directory: PROJECT_DIR,
				parentId: "ses-new",
				title: "subagent",
				updated: 250,
			},
			{
				id: "ses-archived",
				directory: PROJECT_DIR,
				archived: 1,
				title: "archived",
				updated: 260,
			},
		]);

		const items = await collectOpencodeSessions(PROJECT_DIR, dbPath);

		expect(items).toEqual([
			{ cwd: PROJECT_DIR, id: "ses-new", lastModified: 200, title: "newer" },
			{ cwd: PROJECT_DIR, id: "ses-old", lastModified: 100, title: "older" },
		]);
	}
);

it("returns an empty list when the DB file doesn't exist", async () => {
	const items = await collectOpencodeSessions(
		PROJECT_DIR,
		"/nonexistent/opencode.db"
	);
	expect(items).toEqual([]);
});

it("makeOpencodeListSessions degrades a broken store to an empty session_list with an error detail", async () => {
	const dbPath = await makeDbPath();
	await writeFile(dbPath, "this is not a sqlite database at all");
	const events: NormalizedEvent[] = [];
	const listSessions = makeOpencodeListSessions(
		PROJECT_DIR,
		{ push: (event) => events.push(event) },
		dbPath
	);

	listSessions();

	await expect.poll(() => events.length).toBe(1);
	const event = events[0];
	expect(event).toMatchObject({
		kind: "status",
		status: "session_list",
		detail: { sessions: [] },
	});
	const detail = (event as { detail: { error?: string } }).detail;
	expect(typeof detail.error).toBe("string");
});
