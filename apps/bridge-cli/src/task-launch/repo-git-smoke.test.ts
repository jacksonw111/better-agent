import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultGitExec, type GitExec } from "./repo-cache";
import { prepareRepositoryRunWorkspace } from "./repo-workspace";

// S4-T3 real-git smoke (§19.5): the FULL command sequence against a local
// file:// repository — no network, no fakes. Proves the design's exact git
// invocations work on a real bare clone: first task clones + adds a worktree,
// a second task reuses the cache (fetch only, picking up NEW commits) with
// its own independently writable worktree, and a retry of the first task
// reuses its worktree without error.

const TASK_1 = "11111111-0000-4000-8000-000000000001";
const RUN_1 = "aaaaaaaa-0000-4000-8000-000000000001";
const TASK_2 = "22222222-0000-4000-8000-000000000002";
const RUN_2 = "bbbbbbbb-0000-4000-8000-000000000002";

function git(args: string[], cwd?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr || error.message));
			} else {
				resolve(stdout);
			}
		});
	});
}

// File-scope state: the three describes below are ONE story running in file
// order (vitest runs same-file tests sequentially) — task 1 clones, task 2
// reuses the cache, a retry of task 1 reuses its worktree.
let root = "";
let base = "";
let cloneUrl = "";
let srcDir = "";
let ws1 = "";
let ws2 = "";
const gitCalls: string[][] = [];
const recordingExec: GitExec = (args, options) => {
	gitCalls.push([...args]);
	return defaultGitExec(args, options);
};
const repository = () =>
	({
		cloneUrl,
		defaultBranch: "main",
		fullName: "acme/widgets",
		kind: "repository",
	}) as const;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "ba-repo-smoke-"));
	base = join(root, "better-agent");
	srcDir = join(root, "src");
	cloneUrl = `file://${srcDir}`;
	await git(["init", "-q", "-b", "main", srcDir]);
	await git(["config", "user.email", "smoke@test"], srcDir);
	await git(["config", "user.name", "smoke"], srcDir);
	await writeFile(join(srcDir, "hello.txt"), "first commit\n");
	await git(["add", "hello.txt"], srcDir);
	await git(["commit", "-qm", "init"], srcDir);
}, 60_000);

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

describe("real git smoke - first task", () => {
	it("first task bare-clones the cache and works on its own task branch", async () => {
		ws1 = await prepareRepositoryRunWorkspace(
			{ runId: RUN_1, taskId: TASK_1, workspace: repository() },
			{ basePath: base, exec: recordingExec }
		);
		expect(ws1).toBe(join(base, "tasks", TASK_1, "repo"));
		expect(await readFile(join(ws1, "hello.txt"), "utf8")).toBe(
			"first commit\n"
		);
		expect((await git(["branch", "--show-current"], ws1)).trim()).toBe(
			"task/aaaaaaaa"
		);
		expect(gitCalls.some((args) => args[0] === "clone")).toBe(true);
		// Uncommitted work in task 1's worktree — must never leak to task 2.
		await writeFile(join(ws1, "wip.txt"), "task 1 only\n");
	}, 60_000);
});

describe("real git smoke - second task on the same repository", () => {
	it("second task reuses the cache (fetch only) with an independent writable worktree", async () => {
		// New upstream commit between the two launches.
		await writeFile(join(srcDir, "second.txt"), "second commit\n");
		await git(["add", "second.txt"], srcDir);
		await git(["commit", "-qm", "second"], srcDir);

		gitCalls.length = 0;
		ws2 = await prepareRepositoryRunWorkspace(
			{ runId: RUN_2, taskId: TASK_2, workspace: repository() },
			{ basePath: base, exec: recordingExec }
		);
		expect(ws2).toBe(join(base, "tasks", TASK_2, "repo"));
		expect(gitCalls.some((args) => args[0] === "clone")).toBe(false);
		expect(
			gitCalls.some((args) => args.includes("fetch") && args.includes("main"))
		).toBe(true);
		// The fetch actually synced: task 2 sees the new upstream commit.
		expect(await readFile(join(ws2, "second.txt"), "utf8")).toBe(
			"second commit\n"
		);
		// Independent worktrees: task 1's uncommitted file is NOT in task 2.
		await expect(readFile(join(ws2, "wip.txt"), "utf8")).rejects.toThrow();
		// Task 2's worktree is independently writable.
		await writeFile(join(ws2, "own.txt"), "task 2\n");
		await git(["add", "own.txt"], ws2);
		await git(["commit", "-qm", "task 2 work"], ws2);
		await expect(readFile(join(ws1, "own.txt"), "utf8")).rejects.toThrow();
	}, 60_000);
});

describe("real git smoke - retry", () => {
	it("retry of the first task reuses its worktree, uncommitted work intact", async () => {
		gitCalls.length = 0;
		const retried = await prepareRepositoryRunWorkspace(
			{ runId: RUN_1, taskId: TASK_1, workspace: repository() },
			{ basePath: base, exec: recordingExec }
		);
		expect(retried).toBe(ws1);
		expect(gitCalls.some((args) => args.includes("worktree"))).toBe(false);
		// Task 1's uncommitted work survived the retry.
		expect(await readFile(join(ws1, "wip.txt"), "utf8")).toBe("task 1 only\n");
	}, 60_000);
});
