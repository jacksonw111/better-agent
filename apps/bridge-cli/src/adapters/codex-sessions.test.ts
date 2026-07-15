// P4-T1 specs for the codex rollout-log scanner (codex-sessions.ts). Fixture
// rollout files (shape verified against a real ~/.codex/sessions store) are
// written into a per-test temp dir mimicking the YYYY/MM/DD fan-out.

import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { collectCodexSessions, makeCodexListSessions } from "./codex-sessions";

const PROJECT_DIR = "/tmp/codex-project";

let roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true }))
	);
	roots = [];
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "codex-sessions-test-"));
	roots.push(root);
	return root;
}

function rolloutContent(id: string, cwd: string, userText?: string): string {
	const lines = [
		JSON.stringify({
			timestamp: "2026-07-01T00:00:00.000Z",
			type: "session_meta",
			payload: { id, cwd, originator: "codex" },
		}),
		JSON.stringify({
			timestamp: "2026-07-01T00:00:01.000Z",
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "# AGENTS.md instructions" }],
			},
		}),
	];
	if (userText !== undefined) {
		lines.push(
			JSON.stringify({
				timestamp: "2026-07-01T00:00:02.000Z",
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: userText }],
				},
			})
		);
	}
	return `${lines.join("\n")}\n`;
}

async function writeRollout(
	root: string,
	name: string,
	content: string,
	mtimeSec: number
): Promise<void> {
	const day = join(root, "2026", "07", "01");
	await mkdir(day, { recursive: true });
	const path = join(day, name);
	await writeFile(path, content);
	await utimes(path, mtimeSec, mtimeSec);
}

it("collects this project's rollouts newest-first with the first real user message as title", async () => {
	const root = await makeRoot();
	await writeRollout(
		root,
		"rollout-a.jsonl",
		rolloutContent("id-old", PROJECT_DIR, "fix the login bug"),
		1_000_000
	);
	await writeRollout(
		root,
		"rollout-b.jsonl",
		rolloutContent("id-new", PROJECT_DIR, "add dark mode"),
		2_000_000
	);

	const items = await collectCodexSessions(PROJECT_DIR, root);

	expect(items).toEqual([
		{
			cwd: PROJECT_DIR,
			id: "id-new",
			lastModified: 2_000_000_000,
			title: "add dark mode",
		},
		{
			cwd: PROJECT_DIR,
			id: "id-old",
			lastModified: 1_000_000_000,
			title: "fix the login bug",
		},
	]);
});

it("skips other-cwd sessions, malformed files, and falls back to the filename title", async () => {
	const root = await makeRoot();
	await writeRollout(
		root,
		"rollout-other.jsonl",
		rolloutContent("id-other", "/somewhere/else", "not ours"),
		3_000_000
	);
	await writeRollout(
		root,
		"rollout-broken.jsonl",
		"not json at all\n",
		2_500_000
	);
	// No user message beyond the injected AGENTS.md dump → filename title.
	await writeRollout(
		root,
		"rollout-untitled.jsonl",
		rolloutContent("id-untitled", PROJECT_DIR),
		2_000_000
	);

	const items = await collectCodexSessions(PROJECT_DIR, root);

	expect(items).toEqual([
		{
			cwd: PROJECT_DIR,
			id: "id-untitled",
			lastModified: 2_000_000_000,
			title: "rollout-untitled",
		},
	]);
});

it("returns an empty list for a missing sessions root", async () => {
	const items = await collectCodexSessions(
		PROJECT_DIR,
		"/nonexistent/codex/sessions"
	);
	expect(items).toEqual([]);
});

it("caps the list at 50 newest sessions", async () => {
	const root = await makeRoot();
	const writes: Promise<void>[] = [];
	for (let index = 0; index < 55; index += 1) {
		writes.push(
			writeRollout(
				root,
				`rollout-${index}.jsonl`,
				rolloutContent(`id-${index}`, PROJECT_DIR, `prompt ${index}`),
				1_000_000 + index
			)
		);
	}
	await Promise.all(writes);

	const items = await collectCodexSessions(PROJECT_DIR, root);

	expect(items).toHaveLength(50);
	expect(items[0]?.id).toBe("id-54");
});

it("makeCodexListSessions pushes ONE session_list status event", async () => {
	const root = await makeRoot();
	await writeRollout(
		root,
		"rollout-a.jsonl",
		rolloutContent("id-a", PROJECT_DIR, "hello"),
		1_000_000
	);
	const events: NormalizedEvent[] = [];
	const listSessions = makeCodexListSessions(
		PROJECT_DIR,
		{ push: (event) => events.push(event) },
		root
	);

	listSessions();

	await expect.poll(() => events.length).toBe(1);
	expect(events[0]).toEqual({
		kind: "status",
		status: "session_list",
		detail: {
			sessions: [
				{
					cwd: PROJECT_DIR,
					id: "id-a",
					lastModified: 1_000_000_000,
					title: "hello",
				},
			],
		},
	});
});
