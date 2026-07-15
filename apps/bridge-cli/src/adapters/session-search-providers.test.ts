// P4-T5 specs for the per-provider JSONL search wiring
// (session-search-providers.ts). Fixtures mirror the P4-T1 list-scanner tests
// (codex-sessions.test.ts / pi-sessions.test.ts — shapes verified against
// real stores) plus claude's ~/.claude/projects transcript lines.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import {
	makeClaudeSearchSessions,
	makeCodexSearchSessions,
	makePiSearchSessions,
} from "./session-search-providers";

const PROJECT_DIR = "/tmp/search-providers-project";

let roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true }))
	);
	roots = [];
});

async function makeRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

interface SearchDetail {
	partial?: boolean;
	requestId?: string;
	results?: {
		cwd?: string;
		id: string;
		snippets: { role?: string; text: string }[];
		title: string;
	}[];
}

async function runSearch(
	factory: (events: {
		push(event: NormalizedEvent): void;
	}) => (requestId: string, query: string) => void,
	query: string
): Promise<SearchDetail> {
	const events: NormalizedEvent[] = [];
	factory({ push: (event) => events.push(event) })("req-1", query);
	await expect.poll(() => events.length).toBe(1);
	const event = events[0] as { detail: SearchDetail; status: string };
	expect(event.status).toBe("session_search");
	return event.detail;
}

it("codex: matches user and assistant texts, skipping injected context", async () => {
	const root = await makeRoot("codex-search-");
	const day = join(root, "2026", "07", "01");
	await mkdir(day, { recursive: true });
	const lines = [
		JSON.stringify({
			type: "session_meta",
			payload: { id: "codex-1", cwd: PROJECT_DIR },
		}),
		JSON.stringify({
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [
					{ type: "input_text", text: "# AGENTS.md instructions needle" },
				],
			},
		}),
		JSON.stringify({
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "find the needle" }],
			},
		}),
		JSON.stringify({
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "the needle is in git-runner" }],
			},
		}),
	];
	await writeFile(join(day, "rollout-a.jsonl"), `${lines.join("\n")}\n`);

	const detail = await runSearch(
		(events) => makeCodexSearchSessions(PROJECT_DIR, events, root),
		"needle"
	);

	expect(detail.results).toHaveLength(1);
	expect(detail.results?.[0]?.id).toBe("codex-1");
	expect(detail.results?.[0]?.title).toBe("find the needle");
	expect(detail.results?.[0]?.snippets).toEqual([
		{ role: "user", text: "find the needle" },
		{ role: "assistant", text: "the needle is in git-runner" },
	]);
});

it("pi: matches message text parts, filtered to this project's cwd", async () => {
	const root = await makeRoot("pi-search-");
	const projectDir = join(root, "--project--");
	const otherDir = join(root, "--other--");
	await mkdir(projectDir, { recursive: true });
	await mkdir(otherDir, { recursive: true });
	const ours = [
		JSON.stringify({ type: "session", id: "pi-1", cwd: PROJECT_DIR }),
		JSON.stringify({
			type: "message",
			message: {
				role: "user",
				content: [{ type: "text", text: "hunt the needle down" }],
			},
		}),
	];
	const theirs = [
		JSON.stringify({ type: "session", id: "pi-2", cwd: "/somewhere/else" }),
		JSON.stringify({
			type: "message",
			message: {
				role: "user",
				content: [{ type: "text", text: "needle too" }],
			},
		}),
	];
	await writeFile(join(projectDir, "a.jsonl"), `${ours.join("\n")}\n`);
	await writeFile(join(otherDir, "b.jsonl"), `${theirs.join("\n")}\n`);

	const detail = await runSearch(
		(events) => makePiSearchSessions(PROJECT_DIR, events, root),
		"needle"
	);

	expect(detail.results).toHaveLength(1);
	expect(detail.results?.[0]).toMatchObject({
		cwd: PROJECT_DIR,
		id: "pi-1",
		title: "hunt the needle down",
	});
});

it("claude: reads the munged per-project dir, string and part contents both match", async () => {
	const root = await makeRoot("claude-search-");
	const projectDir = join(root, PROJECT_DIR.replace(/[^a-zA-Z0-9]/g, "-"));
	await mkdir(projectDir, { recursive: true });
	const lines = [
		JSON.stringify({
			type: "user",
			cwd: PROJECT_DIR,
			sessionId: "claude-1",
			message: { role: "user", content: "where is the needle" },
		}),
		JSON.stringify({
			type: "assistant",
			cwd: PROJECT_DIR,
			sessionId: "claude-1",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "the needle lives in commands.ts" }],
			},
		}),
	];
	await writeFile(join(projectDir, "claude-1.jsonl"), `${lines.join("\n")}\n`);

	const detail = await runSearch(
		(events) => makeClaudeSearchSessions(PROJECT_DIR, events, root),
		"needle"
	);

	expect(detail.results).toHaveLength(1);
	expect(detail.results?.[0]?.id).toBe("claude-1");
	expect(detail.results?.[0]?.title).toBe("where is the needle");
	expect(detail.results?.[0]?.snippets).toEqual([
		{ role: "user", text: "where is the needle" },
		{ role: "assistant", text: "the needle lives in commands.ts" },
	]);
});

it("claude: falls back to a root scan when the munged dir guess misses", async () => {
	const root = await makeRoot("claude-search-fallback-");
	const oddDir = join(root, "some-unrelated-name");
	await mkdir(oddDir, { recursive: true });
	const lines = [
		JSON.stringify({
			type: "user",
			cwd: PROJECT_DIR,
			sessionId: "claude-2",
			message: { role: "user", content: "fallback needle" },
		}),
	];
	await writeFile(join(oddDir, "claude-2.jsonl"), `${lines.join("\n")}\n`);

	const detail = await runSearch(
		(events) => makeClaudeSearchSessions(PROJECT_DIR, events, root),
		"needle"
	);

	expect(detail.results?.map((hit) => hit.id)).toEqual(["claude-2"]);
});

it("a missing store root settles as empty results, not an error", async () => {
	const detail = await runSearch(
		(events) =>
			makeCodexSearchSessions(PROJECT_DIR, events, "/nonexistent/sessions"),
		"needle"
	);
	expect(detail).toEqual({ partial: false, requestId: "req-1", results: [] });
});
