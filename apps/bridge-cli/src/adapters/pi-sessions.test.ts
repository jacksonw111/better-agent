// P4-T1 specs for the pi session-log scanner (pi-sessions.ts). Fixture logs
// (shape verified against a real ~/.pi/agent/sessions store) are written into
// a per-test temp dir mimicking the per-project subdirectory layout.

import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { collectPiSessions, makePiSessionIndex } from "./pi-sessions";

const PROJECT_DIR = "/tmp/pi-project";

let roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true }))
	);
	roots = [];
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-sessions-test-"));
	roots.push(root);
	return root;
}

function sessionContent(id: string, cwd: string, userText?: string): string {
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id,
			timestamp: "2026-07-06T07:39:40.191Z",
			cwd,
		}),
		JSON.stringify({
			type: "model_change",
			id: "m1",
			parentId: null,
			provider: "test",
			modelId: "test-model",
		}),
	];
	if (userText !== undefined) {
		lines.push(
			JSON.stringify({
				type: "message",
				id: "u1",
				parentId: "m1",
				message: {
					role: "user",
					content: [{ type: "text", text: userText }],
				},
			})
		);
	}
	return `${lines.join("\n")}\n`;
}

async function writeSessionLog(
	dir: string,
	name: string,
	content: string,
	mtimeSec: number
): Promise<void> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, name);
	await writeFile(path, content);
	await utimes(path, mtimeSec, mtimeSec);
}

it("scans the known sessionDir newest-first, titling by the first user message", async () => {
	const root = await makeRoot();
	const sessionDir = join(root, "--tmp-pi-project--");
	await writeSessionLog(
		sessionDir,
		"2026-07-01_old.jsonl",
		sessionContent("pi-old", PROJECT_DIR, "first prompt"),
		1_000_000
	);
	await writeSessionLog(
		sessionDir,
		"2026-07-02_new.jsonl",
		sessionContent("pi-new", PROJECT_DIR, "second prompt"),
		2_000_000
	);

	const items = await collectPiSessions(PROJECT_DIR, sessionDir, root);

	expect(items).toEqual([
		{
			cwd: PROJECT_DIR,
			id: "pi-new",
			lastModified: 2_000_000_000,
			title: "second prompt",
		},
		{
			cwd: PROJECT_DIR,
			id: "pi-old",
			lastModified: 1_000_000_000,
			title: "first prompt",
		},
	]);
});

it("falls back to scanning every project subdir under the root, filtered by header cwd", async () => {
	const root = await makeRoot();
	await writeSessionLog(
		join(root, "--tmp-pi-project--"),
		"ours.jsonl",
		sessionContent("pi-ours", PROJECT_DIR, "ours"),
		2_000_000
	);
	await writeSessionLog(
		join(root, "--somewhere-else--"),
		"theirs.jsonl",
		sessionContent("pi-theirs", "/somewhere/else", "theirs"),
		3_000_000
	);
	await writeSessionLog(
		join(root, "--tmp-pi-project--"),
		"broken.jsonl",
		"{malformed\n",
		2_500_000
	);

	const items = await collectPiSessions(PROJECT_DIR, undefined, root);

	expect(items).toEqual([
		{
			cwd: PROJECT_DIR,
			id: "pi-ours",
			lastModified: 2_000_000_000,
			title: "ours",
		},
	]);
});

it("skips injected <skill …> user messages when titling, falling to the real prompt", async () => {
	const root = await makeRoot();
	const sessionDir = join(root, "--tmp-pi-project--");
	const lines = [
		JSON.stringify({ type: "session", id: "pi-skill", cwd: PROJECT_DIR }),
		JSON.stringify({
			type: "message",
			id: "s1",
			message: {
				role: "user",
				content: [
					{ type: "text", text: '<skill name="code-review">…</skill>' },
				],
			},
		}),
		JSON.stringify({
			type: "message",
			id: "u1",
			message: {
				role: "user",
				content: [{ type: "text", text: "review this diff" }],
			},
		}),
	];
	await writeSessionLog(
		sessionDir,
		"skill.jsonl",
		`${lines.join("\n")}\n`,
		1_000_000
	);

	const [item] = await collectPiSessions(PROJECT_DIR, sessionDir, root);

	expect(item?.title).toBe("review this diff");
});

it("returns an empty list when neither the sessionDir nor the root exists", async () => {
	const items = await collectPiSessions(
		PROJECT_DIR,
		"/nonexistent/session-dir",
		"/nonexistent/pi/sessions"
	);
	expect(items).toEqual([]);
});

it("collapses whitespace and caps long first prompts at 80 chars", async () => {
	const root = await makeRoot();
	const sessionDir = join(root, "--tmp-pi-project--");
	const longPrompt = `refactor\nthe   whole ${"x".repeat(120)}`;
	await writeSessionLog(
		sessionDir,
		"long.jsonl",
		sessionContent("pi-long", PROJECT_DIR, longPrompt),
		1_000_000
	);

	const [item] = await collectPiSessions(PROJECT_DIR, sessionDir, root);

	expect(item?.title).toHaveLength(80);
	expect(item?.title.startsWith("refactor the whole xxx")).toBe(true);
	expect(item?.title.endsWith("…")).toBe(true);
});

it("makePiSessionIndex scans the directory captured off get_state's sessionFile", async () => {
	const root = await makeRoot();
	const sessionDir = join(root, "--tmp-pi-project--");
	await writeSessionLog(
		sessionDir,
		"live.jsonl",
		sessionContent("pi-live", PROJECT_DIR, "hello pi"),
		1_000_000
	);
	const events: NormalizedEvent[] = [];
	const index = makePiSessionIndex(
		PROJECT_DIR,
		{ push: (event) => events.push(event) },
		"/nonexistent/pi/sessions" // root unusable — only the captured dir works
	);

	index.onLine({
		type: "response",
		command: "get_state",
		success: true,
		data: { sessionFile: join(sessionDir, "live.jsonl"), sessionId: "pi-live" },
	});
	index.listSessions();

	await expect.poll(() => events.length).toBe(1);
	expect(events[0]).toEqual({
		kind: "status",
		status: "session_list",
		detail: {
			sessions: [
				{
					cwd: PROJECT_DIR,
					id: "pi-live",
					lastModified: 1_000_000_000,
					title: "hello pi",
				},
			],
		},
	});
});
