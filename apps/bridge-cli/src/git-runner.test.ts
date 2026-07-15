import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createGitRunner, withGitRunner } from "./git-runner";
import type { StatusEvent } from "./normalize/types";

// P4-T4: the git channel against REAL temp repos (git init in os.tmpdir —
// never inside this worktree): status parsing end-to-end, the not-a-repo
// guard, diff chunking, and the commit ok/nothing/failure replies.

const SHORT_HASH_RE = /^[0-9a-f]{4,}$/;

interface Detail {
	ahead?: number;
	branch?: string;
	chunkIndex?: number;
	content?: string;
	done?: boolean;
	entries?: { origPath?: string; path: string; x: string; y: string }[];
	error?: string;
	hash?: string;
	notARepo?: boolean;
	ok?: boolean;
	requestId?: string;
	totalChunks?: number;
	truncated?: boolean;
}

function git(dir: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd: dir }, (error, stdout) => {
			if (error) {
				reject(error);
			} else {
				resolve(stdout);
			}
		});
	});
}

/** A fresh real repo (in os.tmpdir, NEVER this worktree) with one commit. */
async function initRepo(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "git-runner-"));
	await git(dir, ["init", "-b", "main"]);
	await git(dir, ["config", "user.email", "test@example.com"]);
	await git(dir, ["config", "user.name", "test"]);
	await git(dir, ["config", "commit.gpgsign", "false"]);
	await writeFile(path.join(dir, "base.txt"), "base\n");
	await git(dir, ["add", "-A"]);
	await git(dir, ["commit", "-m", "init"]);
	return dir;
}

function collect(dir: string) {
	const details: Detail[] = [];
	const runner = createGitRunner({
		dir,
		pushEvent: (event) => details.push((event as StatusEvent).detail as Detail),
	});
	return { details, runner };
}

async function settled(details: Detail[], count = 1): Promise<void> {
	await vi.waitFor(() => expect(details.length).toBeGreaterThanOrEqual(count));
}

it("reports the branch plus staged/unstaged/untracked entries", async () => {
	const dir = await initRepo();
	await writeFile(path.join(dir, "base.txt"), "changed\n");
	await writeFile(path.join(dir, "staged.txt"), "staged\n");
	await git(dir, ["add", "staged.txt"]);
	await writeFile(path.join(dir, "new.txt"), "untracked\n");
	const { details, runner } = collect(dir);
	runner.status("req-1");
	await settled(details);
	const detail = details[0];
	expect(detail?.requestId).toBe("req-1");
	expect(detail?.branch).toBe("main");
	expect(detail?.truncated).toBe(false);
	expect(detail?.entries).toEqual(
		expect.arrayContaining([
			{ path: "base.txt", x: " ", y: "M" },
			{ path: "staged.txt", x: "A", y: " " },
			{ path: "new.txt", x: "?", y: "?" },
		])
	);
});

it("replies notARepo for a directory that is not a git repo", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "git-runner-plain-"));
	const { details, runner } = collect(dir);
	runner.status("req-2");
	await settled(details);
	expect(details[0]).toMatchObject({ notARepo: true, requestId: "req-2" });
});

it("chunks a large diff, done only on the last chunk", async () => {
	const dir = await initRepo();
	await writeFile(
		path.join(dir, "base.txt"),
		`${"lorem ipsum dolor sit amet\n".repeat(1500)}`
	);
	const { details, runner } = collect(dir);
	runner.diff("req-3");
	await settled(details, 2);
	await vi.waitFor(() => expect(details.at(-1)?.done).toBe(true));
	expect(details.length).toBeGreaterThan(1);
	expect(details.map((detail) => detail.chunkIndex)).toEqual(
		details.map((_, index) => index)
	);
	expect(details.every((detail) => detail.totalChunks === details.length)).toBe(
		true
	);
	const joined = details.map((detail) => detail.content).join("");
	expect(joined).toContain("=== 未暂存 ===");
	expect(joined).toContain("+lorem ipsum dolor sit amet");
});

it("diffs a single untracked path via the no-index fallback", async () => {
	const dir = await initRepo();
	await writeFile(path.join(dir, "fresh.txt"), "brand new line\n");
	const { details, runner } = collect(dir);
	runner.diff("req-4", "fresh.txt");
	await settled(details);
	const joined = details.map((detail) => detail.content).join("");
	expect(joined).toContain("=== 未跟踪 ===");
	expect(joined).toContain("+brand new line");
});

it("commits all working-tree changes and replies with the hash", async () => {
	const dir = await initRepo();
	await writeFile(path.join(dir, "base.txt"), "committed change\n");
	await writeFile(path.join(dir, "extra.txt"), "also committed\n");
	const { details, runner } = collect(dir);
	runner.commit("req-5", "feat: test commit");
	await settled(details);
	expect(details[0]?.ok).toBe(true);
	expect(details[0]?.requestId).toBe("req-5");
	expect(details[0]?.hash).toMatch(SHORT_HASH_RE);
	expect((await git(dir, ["status", "--porcelain"])).trim()).toBe("");
	expect(await git(dir, ["log", "-1", "--format=%s"])).toContain(
		"feat: test commit"
	);
});

it("replies with errors for a clean tree, an empty message and a non-repo", async () => {
	const clean = await initRepo();
	const plain = await mkdtemp(path.join(tmpdir(), "git-runner-plain-"));
	const cleanRun = collect(clean);
	cleanRun.runner.commit("req-6", "msg");
	await settled(cleanRun.details);
	expect(cleanRun.details[0]?.error).toContain("nothing to commit");
	cleanRun.runner.commit("req-7", "   ");
	await settled(cleanRun.details, 2);
	expect(cleanRun.details[1]?.error).toContain("empty commit message");
	const plainRun = collect(plain);
	plainRun.runner.commit("req-8", "msg");
	await settled(plainRun.details);
	expect(plainRun.details[0]?.error).toBeTruthy();
	expect(plainRun.details[0]?.ok).toBeUndefined();
});

it("withGitRunner keeps inherited methods as own enumerable properties", () => {
	const handle = { send: vi.fn(), stop: vi.fn() };
	const wrapped = withGitRunner(handle, {
		dir: tmpdir(),
		pushEvent: () => undefined,
	});
	const spread = { ...wrapped };
	expect(typeof spread.send).toBe("function");
	expect(typeof spread.gitStatus).toBe("function");
	expect(typeof spread.gitDiff).toBe("function");
	expect(typeof spread.gitCommit).toBe("function");
});
