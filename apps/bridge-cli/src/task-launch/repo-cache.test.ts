import type { RepositoryWorkspaceIntent } from "@better-agent/agent/task-ports";
import { describe, expect, it } from "vitest";
import {
	ensureRepoCache,
	GIT_ERROR_MAX_CHARS,
	type GitExec,
	repoCacheDir,
	repoLockPath,
} from "./repo-cache";
import type { RepoLockDeps } from "./repo-lock";

// S4-T3 (design D5, master spec §6.16/§18.5): the per-Computer Repository
// Cache — one bare clone per repository identity. First launch bare-clones
// (plus the remote-tracking refspec + initial fetch that make
// `origin/<defaultBranch>` resolvable in a bare repo); later launches only
// fetch — the same repository is NEVER fully cloned twice. clone/fetch run
// under the cache file lock, and any git failure surfaces the REAL stderr
// (§16), truncated to a bounded length — never swallowed, never preflighted.

const BASE = "/base";
const REPO: RepositoryWorkspaceIntent = {
	cloneUrl: "https://github.com/acme/widgets.git",
	defaultBranch: "main",
	fullName: "acme/widgets",
	kind: "repository",
};
const BARE_DIR = "/base/cache/repos/acme__widgets";

function okExec(recorded: string[][]): GitExec {
	return (args) => {
		recorded.push([...args]);
		return Promise.resolve({ code: 0, stderr: "", stdout: "" });
	};
}

function inMemoryLock(events?: string[]): RepoLockDeps {
	const held = new Set<string>();
	return {
		now: () => Date.now(),
		sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
		statMtimeMs: () => Promise.resolve(Date.now()),
		unlinkIfExists: (path) => {
			held.delete(path);
			events?.push("unlock");
			return Promise.resolve();
		},
		writeExclusive: (path) => {
			if (held.has(path)) {
				return Promise.resolve(false);
			}
			held.add(path);
			events?.push("lock");
			return Promise.resolve(true);
		},
	};
}

describe("cache layout", () => {
	it("maps a repository identity to <base>/cache/repos/<owner>__<repo>", () => {
		expect(repoCacheDir(BASE, REPO.fullName)).toBe(BARE_DIR);
	});

	it("puts the lock file next to the cache directory", () => {
		expect(repoLockPath(BASE, REPO.fullName)).toBe(`${BARE_DIR}.lock`);
	});
});

describe("ensureRepoCache - first launch (no cache)", () => {
	it("bare-clones, wires the remote-tracking refspec and fetches, under the lock", async () => {
		const timeline: string[] = [];
		const commands: string[][] = [];
		const mkdirs: string[] = [];
		const exec: GitExec = (args) => {
			commands.push([...args]);
			timeline.push(`git ${args.join(" ")}`);
			return Promise.resolve({ code: 0, stderr: "", stdout: "" });
		};
		const bareDir = await ensureRepoCache(REPO, {
			basePath: BASE,
			exec,
			exists: () => Promise.resolve(false),
			lock: inMemoryLock(timeline),
			mkdirRecursive: (path) => {
				mkdirs.push(path);
				return Promise.resolve();
			},
		});
		expect(bareDir).toBe(BARE_DIR);
		expect(mkdirs).toEqual(["/base/cache/repos"]);
		expect(commands).toEqual([
			["clone", "--bare", REPO.cloneUrl, BARE_DIR],
			[
				"--git-dir",
				BARE_DIR,
				"config",
				"remote.origin.fetch",
				"+refs/heads/*:refs/remotes/origin/*",
			],
			["--git-dir", BARE_DIR, "fetch", "origin", "main"],
		]);
		expect(timeline.at(0)).toBe("lock");
		expect(timeline.at(-1)).toBe("unlock");
	});
});

describe("ensureRepoCache - cache already present", () => {
	it("only fetches the default branch — never a second full clone (§18.5)", async () => {
		const commands: string[][] = [];
		const bareDir = await ensureRepoCache(REPO, {
			basePath: BASE,
			exec: okExec(commands),
			exists: () => Promise.resolve(true),
			lock: inMemoryLock(),
			mkdirRecursive: () => Promise.resolve(),
		});
		expect(bareDir).toBe(BARE_DIR);
		expect(commands).toEqual([
			["--git-dir", BARE_DIR, "fetch", "origin", "main"],
		]);
	});
});

describe("ensureRepoCache - git failure", () => {
	it("throws the REAL clone stderr and still releases the lock", async () => {
		const timeline: string[] = [];
		const exec: GitExec = () =>
			Promise.resolve({
				code: 128,
				stderr:
					"fatal: Authentication failed for 'https://github.com/acme/widgets.git/'",
				stdout: "",
			});
		await expect(
			ensureRepoCache(REPO, {
				basePath: BASE,
				exec,
				exists: () => Promise.resolve(false),
				lock: inMemoryLock(timeline),
				mkdirRecursive: () => Promise.resolve(),
			})
		).rejects.toThrow("fatal: Authentication failed");
		expect(timeline).toEqual(["lock", "unlock"]);
	});

	it("truncates a huge stderr to a bounded length", async () => {
		const hugeStderr = "x".repeat(GIT_ERROR_MAX_CHARS * 3);
		const exec: GitExec = () =>
			Promise.resolve({ code: 1, stderr: hugeStderr, stdout: "" });
		let caught: unknown;
		try {
			await ensureRepoCache(REPO, {
				basePath: BASE,
				exec,
				exists: () => Promise.resolve(true),
				lock: inMemoryLock(),
				mkdirRecursive: () => Promise.resolve(),
			});
		} catch (error) {
			caught = error;
		}
		const message = caught instanceof Error ? caught.message : "";
		expect(message.length).toBeLessThanOrEqual(GIT_ERROR_MAX_CHARS + 100);
		expect(message).toContain("x".repeat(100));
	});
});

describe("ensureRepoCache - concurrent launches of the same repository", () => {
	it("serializes clone/fetch under the lock: git commands never overlap (§19.5)", async () => {
		const events: string[] = [];
		const cloned = new Set<string>();
		let inFlight = 0;
		let maxInFlight = 0;
		const exec: GitExec = async (args) => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			events.push(`start git ${args[0] === "--git-dir" ? args[2] : args[0]}`);
			await new Promise((resolve) => setTimeout(resolve, 2));
			if (args[0] === "clone") {
				cloned.add(args.at(-1) ?? "");
			}
			events.push("end");
			inFlight -= 1;
			return { code: 0, stderr: "", stdout: "" };
		};
		const lock = inMemoryLock();
		const deps = {
			basePath: BASE,
			exec,
			exists: (path: string) => Promise.resolve(cloned.has(path)),
			lock,
			mkdirRecursive: () => Promise.resolve(),
		};
		const [first, second] = await Promise.all([
			ensureRepoCache(REPO, deps),
			ensureRepoCache(REPO, deps),
		]);
		expect(first).toBe(BARE_DIR);
		expect(second).toBe(BARE_DIR);
		// The lock serialized everything: never two git commands at once.
		expect(maxInFlight).toBe(1);
		// Exactly ONE full clone happened across both launches (§18.5).
		expect(events.filter((entry) => entry === "start git clone")).toHaveLength(
			1
		);
	});
});
