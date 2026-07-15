// P4-T5 specs for the opencode SQLite content search (opencode-search.ts).
// Same optional-node:sqlite arrangement as opencode-sessions.test.ts: each
// test builds a tiny temp DB through the module the implementation reads
// with, and DB-backed tests skip gracefully when the runtime lacks it.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { escapeLikePattern, searchOpencodeSessions } from "./opencode-search";

const PROJECT_DIR = "/tmp/opencode-search-project";

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

const SCHEMA = `
	CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT,
		time_updated INTEGER, parent_id TEXT, time_archived INTEGER);
	CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
	CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
		time_created INTEGER, data TEXT);
`;

interface PartRow {
	role?: string;
	sessionId: string;
	text: string;
}

async function makeDb(parts: PartRow[]): Promise<string> {
	if (!DatabaseSync) {
		throw new Error("node:sqlite unavailable");
	}
	const root = await mkdtemp(join(tmpdir(), "opencode-search-test-"));
	roots.push(root);
	const path = join(root, "opencode.db");
	const db = new DatabaseSync(path);
	db.exec(SCHEMA);
	const sessions = new Set(parts.map((part) => part.sessionId));
	let order = 0;
	for (const sessionId of sessions) {
		db.prepare(
			"INSERT INTO session (id, title, directory, time_updated) VALUES (?, ?, ?, ?)"
		).run(sessionId, `title of ${sessionId}`, PROJECT_DIR, 1000 + order);
		order += 1;
	}
	for (const [index, part] of parts.entries()) {
		const messageId = `m-${index}`;
		db.prepare(
			"INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)"
		).run(
			messageId,
			part.sessionId,
			JSON.stringify({ role: part.role ?? "user" })
		);
		db.prepare(
			"INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)"
		).run(
			`p-${index}`,
			messageId,
			part.sessionId,
			index,
			JSON.stringify({ type: "text", text: part.text })
		);
	}
	db.close();
	return path;
}

it("escapeLikePattern makes %, _ and \\ literal", () => {
	expect(escapeLikePattern("100% _done_ a\\b")).toBe(
		"100\\% \\_done\\_ a\\\\b"
	);
});

it("finds matching sessions with role-tagged snippets, grouped per session", async () => {
	if (!DatabaseSync) {
		return;
	}
	const dbPath = await makeDb([
		{ sessionId: "s-1", text: "please fix the login flow" },
		{ sessionId: "s-1", text: "login now validates", role: "assistant" },
		{ sessionId: "s-2", text: "unrelated dark mode work" },
	]);

	const outcome = await searchOpencodeSessions(PROJECT_DIR, "login", dbPath);

	expect(outcome.partial).toBe(false);
	expect(outcome.results).toEqual([
		{
			cwd: PROJECT_DIR,
			id: "s-1",
			lastModified: 1000,
			snippets: [
				{ role: "user", text: "please fix the login flow" },
				{ role: "assistant", text: "login now validates" },
			],
			title: "title of s-1",
		},
	]);
});

it("treats LIKE specials in the query as literals", async () => {
	if (!DatabaseSync) {
		return;
	}
	const dbPath = await makeDb([
		{ sessionId: "s-1", text: "progress is 100% done" },
		{ sessionId: "s-2", text: "progress is 100x done" },
	]);

	const outcome = await searchOpencodeSessions(PROJECT_DIR, "100%", dbPath);

	expect(outcome.results.map((hit) => hit.id)).toEqual(["s-1"]);
});

it("another directory's sessions never match", async () => {
	if (!DatabaseSync) {
		return;
	}
	const dbPath = await makeDb([{ sessionId: "s-1", text: "the needle" }]);

	const outcome = await searchOpencodeSessions("/other/dir", "needle", dbPath);

	expect(outcome.results).toEqual([]);
});

it("a missing DB file is empty results, not an error", async () => {
	const outcome = await searchOpencodeSessions(
		PROJECT_DIR,
		"needle",
		"/nonexistent/opencode.db"
	);
	expect(outcome).toEqual({ partial: false, results: [] });
});
