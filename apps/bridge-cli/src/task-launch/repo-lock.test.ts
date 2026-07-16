import { describe, expect, it } from "vitest";
import {
	acquireRepoLock,
	LOCK_POLL_INTERVAL_MS,
	LOCK_STALE_MS,
	type RepoLockDeps,
} from "./repo-lock";

// S4-T3 (design D5, master spec §6.16): the Repository Cache file lock that
// serializes clone/fetch across concurrent launches. Acquisition is an
// exclusive `wx` create of `<cache dir>.lock`; the holder writes pid +
// timestamp; waiters poll every 200ms; a lock whose mtime is older than 60s
// is stale and preempted. Real filesystem errors propagate — never swallowed.

const LOCK_PATH = "/base/cache/repos/acme__widgets.lock";

function fakeLockWorld(startTime = 100_000) {
	const files = new Map<string, { content: string; mtimeMs: number }>();
	const slept: number[] = [];
	let time = startTime;
	const deps: RepoLockDeps = {
		now: () => time,
		pid: 4242,
		sleep: (ms) => {
			slept.push(ms);
			time += ms;
			return Promise.resolve();
		},
		statMtimeMs: (path) => Promise.resolve(files.get(path)?.mtimeMs ?? null),
		unlinkIfExists: (path) => {
			files.delete(path);
			return Promise.resolve();
		},
		writeExclusive: (path, content) => {
			if (files.has(path)) {
				return Promise.resolve(false);
			}
			files.set(path, { content, mtimeMs: time });
			return Promise.resolve(true);
		},
	};
	return {
		deps,
		files,
		holdLock: (ageMs: number) => {
			files.set(LOCK_PATH, {
				content: "9999\n0",
				mtimeMs: time - ageMs,
			});
		},
		slept,
	};
}

describe("acquireRepoLock - free lock", () => {
	it("creates the lock file with pid and timestamp, and release removes it", async () => {
		const world = fakeLockWorld();
		const lock = await acquireRepoLock(LOCK_PATH, world.deps);
		const entry = world.files.get(LOCK_PATH);
		expect(entry?.content).toContain("4242");
		expect(entry?.content).toContain("100000");
		expect(world.slept).toEqual([]);
		await lock.release();
		expect(world.files.has(LOCK_PATH)).toBe(false);
	});
});

describe("acquireRepoLock - held lock", () => {
	it("polls every 200ms until the holder releases, then acquires", async () => {
		const world = fakeLockWorld();
		world.holdLock(0);
		// The holder releases after the waiter has slept twice.
		const originalSleep = world.deps.sleep;
		let sleeps = 0;
		world.deps.sleep = (ms) => {
			sleeps += 1;
			if (sleeps === 2) {
				world.files.delete(LOCK_PATH);
			}
			return originalSleep?.(ms) ?? Promise.resolve();
		};
		const lock = await acquireRepoLock(LOCK_PATH, world.deps);
		expect(world.slept).toEqual([LOCK_POLL_INTERVAL_MS, LOCK_POLL_INTERVAL_MS]);
		expect(world.files.get(LOCK_PATH)?.content).toContain("4242");
		await lock.release();
	});

	it("does NOT preempt a lock exactly at the staleness threshold", async () => {
		const world = fakeLockWorld();
		world.holdLock(LOCK_STALE_MS);
		const originalSleep = world.deps.sleep;
		world.deps.sleep = (ms) => {
			world.files.delete(LOCK_PATH); // holder releases during the wait
			return originalSleep?.(ms) ?? Promise.resolve();
		};
		await acquireRepoLock(LOCK_PATH, world.deps);
		expect(world.slept).toEqual([LOCK_POLL_INTERVAL_MS]);
	});
});

describe("acquireRepoLock - stale lock", () => {
	it("preempts a lock whose mtime is older than 60s without sleeping", async () => {
		const world = fakeLockWorld();
		world.holdLock(LOCK_STALE_MS + 1);
		const lock = await acquireRepoLock(LOCK_PATH, world.deps);
		expect(world.slept).toEqual([]);
		expect(world.files.get(LOCK_PATH)?.content).toContain("4242");
		await lock.release();
	});

	it("retries immediately when the lock vanishes between create and stat", async () => {
		const world = fakeLockWorld();
		let firstAttempt = true;
		const originalWrite = world.deps.writeExclusive;
		world.deps.writeExclusive = (path, content) => {
			if (firstAttempt) {
				firstAttempt = false;
				return Promise.resolve(false); // lost the race...
			}
			return originalWrite?.(path, content) ?? Promise.resolve(true);
		};
		// ...but the winner already released: stat finds nothing.
		await acquireRepoLock(LOCK_PATH, world.deps);
		expect(world.slept).toEqual([]);
	});
});

describe("acquireRepoLock - real errors", () => {
	it("propagates a real filesystem error instead of swallowing it", async () => {
		const world = fakeLockWorld();
		world.deps.writeExclusive = () =>
			Promise.reject(new Error("EACCES: permission denied, open"));
		await expect(acquireRepoLock(LOCK_PATH, world.deps)).rejects.toThrow(
			"EACCES: permission denied, open"
		);
	});
});
