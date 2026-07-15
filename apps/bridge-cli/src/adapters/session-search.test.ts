// P4-T5 specs for the shared search engine (session-search.ts): snippet
// windowing, the byte-fit + partial semantics of the single reply, and the
// generic bounded JSONL scan (cwd filter, caps, time box) over a minimal
// test-only line format.

import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { isRecord } from "../normalize/types";
import { newestFiles } from "./session-history-files";
import {
	buildSnippet,
	makeSearchSessions,
	pushSessionSearch,
	SEARCH_SESSION_CAP,
	type SessionSearchHit,
} from "./session-search";
import {
	type JsonlSearchFormat,
	searchJsonlTranscripts,
} from "./session-search-jsonl";

const PROJECT_DIR = "/tmp/search-project";
const FAR_DEADLINE = Number.MAX_SAFE_INTEGER;

/** Minimal line format: `{t:"h", id, cwd}` header, `{t:"m", role, text}`. */
const testFormat: JsonlSearchFormat = {
	header(line) {
		if (isRecord(line) && line.t === "h") {
			return {
				cwd: typeof line.cwd === "string" ? line.cwd : undefined,
				id: typeof line.id === "string" ? line.id : undefined,
			};
		}
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	},
	texts(line) {
		if (isRecord(line) && line.t === "m" && typeof line.text === "string") {
			return [
				{
					role: typeof line.role === "string" ? line.role : undefined,
					text: line.text,
				},
			];
		}
		return [];
	},
	title(line) {
		if (isRecord(line) && line.t === "m" && line.role === "user") {
			return typeof line.text === "string" ? line.text : undefined;
		}
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	},
};

let roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true }))
	);
	roots = [];
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "session-search-test-"));
	roots.push(root);
	return root;
}

function transcript(
	id: string,
	cwd: string,
	messages: [string, string][]
): string {
	const lines = [JSON.stringify({ t: "h", id, cwd })];
	for (const [role, text] of messages) {
		lines.push(JSON.stringify({ t: "m", role, text }));
	}
	return `${lines.join("\n")}\n`;
}

async function writeTranscript(
	root: string,
	name: string,
	content: string,
	mtimeSec: number
): Promise<void> {
	const path = join(root, name);
	await writeFile(path, content);
	await utimes(path, mtimeSec, mtimeSec);
}

async function search(root: string, query: string, deadline = FAR_DEADLINE) {
	const files = await newestFiles(root, {
		extension: ".jsonl",
		max: 100,
		maxDepth: 1,
	});
	return await searchJsonlTranscripts({
		deadline,
		dir: PROJECT_DIR,
		files,
		format: testFormat,
		query,
	});
}

it("buildSnippet matches case-insensitively and centers the match in a 160-char window", () => {
	expect(buildSnippet("Fix the Login bug", "login")).toBe("Fix the Login bug");
	expect(buildSnippet("no match here", "login")).toBeUndefined();
	const long = `${"a".repeat(300)} needle ${"b".repeat(300)}`;
	const snippet = buildSnippet(long, "needle");
	expect(snippet).toBeDefined();
	expect(snippet).toContain("needle");
	expect(snippet?.length).toBeLessThanOrEqual(162); // 160 + the two … marks
	expect(snippet?.startsWith("…")).toBe(true);
	expect(snippet?.endsWith("…")).toBe(true);
});

it("buildSnippet collapses whitespace so a match across newlines still lands", () => {
	expect(buildSnippet("fix\n\n  the   login\tbug", "the login")).toBe(
		"fix the login bug"
	);
});

it("finds matching sessions newest-first with role-tagged snippets and a title", async () => {
	const root = await makeRoot();
	await writeTranscript(
		root,
		"old.jsonl",
		transcript("id-old", PROJECT_DIR, [
			["user", "fix the login bug"],
			["assistant", "The login form now validates."],
		]),
		1_000_000
	);
	await writeTranscript(
		root,
		"new.jsonl",
		transcript("id-new", PROJECT_DIR, [["user", "add dark mode"]]),
		2_000_000
	);

	const outcome = await search(root, "login");

	expect(outcome.partial).toBe(false);
	expect(outcome.results).toEqual([
		{
			cwd: PROJECT_DIR,
			id: "id-old",
			lastModified: 1_000_000_000,
			snippets: [
				{ role: "user", text: "fix the login bug" },
				{ role: "assistant", text: "The login form now validates." },
			],
			title: "fix the login bug",
		},
	]);
});

it("skips other-cwd transcripts and caps snippets at 3 per session", async () => {
	const root = await makeRoot();
	await writeTranscript(
		root,
		"other.jsonl",
		transcript("id-other", "/somewhere/else", [["user", "login here too"]]),
		2_000_000
	);
	const many: [string, string][] = Array.from({ length: 6 }, (_, index) => [
		"user",
		`login attempt ${index}`,
	]);
	await writeTranscript(
		root,
		"ours.jsonl",
		transcript("id-ours", PROJECT_DIR, many),
		1_000_000
	);

	const outcome = await search(root, "login");

	expect(outcome.results).toHaveLength(1);
	expect(outcome.results[0]?.id).toBe("id-ours");
	expect(outcome.results[0]?.snippets).toHaveLength(3);
});

it("caps matched sessions at SEARCH_SESSION_CAP", async () => {
	const root = await makeRoot();
	const writes: Promise<void>[] = [];
	for (let index = 0; index < SEARCH_SESSION_CAP + 5; index += 1) {
		writes.push(
			writeTranscript(
				root,
				`t-${index}.jsonl`,
				transcript(`id-${index}`, PROJECT_DIR, [["user", "shared needle"]]),
				1_000_000 + index
			)
		);
	}
	await Promise.all(writes);

	const outcome = await search(root, "needle");

	expect(outcome.results).toHaveLength(SEARCH_SESSION_CAP);
});

it("an already-expired time box ends the scan with partial: true", async () => {
	const root = await makeRoot();
	await writeTranscript(
		root,
		"a.jsonl",
		transcript("id-a", PROJECT_DIR, [["user", "needle"]]),
		1_000_000
	);

	const outcome = await search(root, "needle", 0);

	expect(outcome).toEqual({ partial: true, results: [] });
});

it("pushSessionSearch byte-fits oversized results and marks the reply partial", () => {
	const big: SessionSearchHit[] = Array.from({ length: 20 }, (_, index) => ({
		id: `id-${index}`,
		lastModified: index,
		snippets: [{ text: "x".repeat(3000) }],
		title: `t-${index}`,
	}));
	const events: NormalizedEvent[] = [];

	pushSessionSearch({ push: (event) => events.push(event) }, "req-1", {
		partial: false,
		results: big,
	});

	expect(events).toHaveLength(1);
	const detail = (events[0] as { detail: Record<string, unknown> }).detail;
	expect(detail.requestId).toBe("req-1");
	expect(detail.partial).toBe(true);
	const results = detail.results as SessionSearchHit[];
	expect(results.length).toBeLessThan(big.length);
	expect(
		Buffer.byteLength(JSON.stringify(results), "utf8")
	).toBeLessThanOrEqual(24_000);
});

it("makeSearchSessions answers a blank query immediately and a failure as an error detail", async () => {
	const events: NormalizedEvent[] = [];
	const sink = { push: (event: NormalizedEvent) => events.push(event) };
	const failing = makeSearchSessions(sink, () =>
		Promise.reject(new Error("store exploded"))
	);

	makeSearchSessions(sink, () =>
		Promise.resolve({ partial: false, results: [] })
	)("req-blank", "   ");
	failing("req-fail", "needle");

	await expect.poll(() => events.length).toBe(2);
	expect(events[0]).toEqual({
		kind: "status",
		status: "session_search",
		detail: { partial: false, requestId: "req-blank", results: [] },
	});
	expect(events[1]).toEqual({
		kind: "status",
		status: "session_search",
		detail: { error: "store exploded", requestId: "req-fail", results: [] },
	});
});
