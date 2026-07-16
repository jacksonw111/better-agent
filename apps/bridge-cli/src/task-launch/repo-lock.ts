import { stat, unlink, writeFile } from "node:fs/promises";

// S4-T3 (design D5, master spec §6.16): the Repository Cache file lock. One
// `<cache dir>.lock` file serializes clone/fetch of the same repository
// across concurrent launches — acquisition is an atomic exclusive (`wx`)
// create, the holder records pid + timestamp for debuggability, waiters poll
// every `LOCK_POLL_INTERVAL_MS`, and a lock whose mtime is more than
// `LOCK_STALE_MS` old is presumed abandoned (crashed holder) and preempted.
// Every filesystem dependency is injectable so the protocol is fully unit
// testable; only ENOENT/EEXIST are interpreted — real errors propagate (§16).

/** How long a waiter sleeps between acquisition attempts. */
export const LOCK_POLL_INTERVAL_MS = 200;
/** A lock file whose mtime is MORE than this old is stale and preempted. */
export const LOCK_STALE_MS = 60_000;

export interface RepoLockDeps {
	now?: () => number;
	pid?: number;
	sleep?: (ms: number) => Promise<void>;
	/** The lock file's mtime in ms, or null when it does not exist. */
	statMtimeMs?: (path: string) => Promise<number | null>;
	/** Removes the file; missing files are fine, real errors propagate. */
	unlinkIfExists?: (path: string) => Promise<void>;
	/** Atomically creates the file (`wx`): false when it already exists. */
	writeExclusive?: (path: string, content: string) => Promise<boolean>;
}

export interface RepoLock {
	release(): Promise<void>;
}

function errnoCode(error: unknown): string | undefined {
	return (error as { code?: string } | null)?.code;
}

async function defaultWriteExclusive(
	path: string,
	content: string
): Promise<boolean> {
	try {
		await writeFile(path, content, { flag: "wx" });
		return true;
	} catch (error) {
		if (errnoCode(error) === "EEXIST") {
			return false;
		}
		throw error;
	}
}

async function defaultStatMtimeMs(path: string): Promise<number | null> {
	try {
		return (await stat(path)).mtimeMs;
	} catch (error) {
		if (errnoCode(error) === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function defaultUnlinkIfExists(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (errnoCode(error) !== "ENOENT") {
			throw error;
		}
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDeps(deps: RepoLockDeps): Required<RepoLockDeps> {
	return {
		now: deps.now ?? Date.now,
		pid: deps.pid ?? process.pid,
		sleep: deps.sleep ?? defaultSleep,
		statMtimeMs: deps.statMtimeMs ?? defaultStatMtimeMs,
		unlinkIfExists: deps.unlinkIfExists ?? defaultUnlinkIfExists,
		writeExclusive: deps.writeExclusive ?? defaultWriteExclusive,
	};
}

/**
 * Acquires the repository cache lock at `lockPath`, waiting (200ms polls) for
 * a live holder and preempting a stale one. Resolves to a handle whose
 * `release` removes the lock file.
 */
export async function acquireRepoLock(
	lockPath: string,
	deps: RepoLockDeps = {}
): Promise<RepoLock> {
	const { now, pid, sleep, statMtimeMs, unlinkIfExists, writeExclusive } =
		resolveDeps(deps);
	for (;;) {
		if (await writeExclusive(lockPath, `${pid}\n${now()}\n`)) {
			return { release: () => unlinkIfExists(lockPath) };
		}
		const mtimeMs = await statMtimeMs(lockPath);
		if (mtimeMs === null) {
			continue; // The holder released between our create and stat — retry now.
		}
		if (now() - mtimeMs > LOCK_STALE_MS) {
			// Presumed-crashed holder: remove the stale lock and retry at once.
			// If two waiters race the unlink, the `wx` create still elects one.
			await unlinkIfExists(lockPath);
			continue;
		}
		await sleep(LOCK_POLL_INTERVAL_MS);
	}
}
