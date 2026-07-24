import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// P1-C (DP3): the minimal filesystem surface `agent-cli sync` needs, injected so
// the landing logic can run against an in-memory fake in tests. Every method is
// forgiving of a missing target the way the sync wants it: `readFile` returns
// null on ENOENT (a first-ever sync), `readdir` returns [], and `rm` treats a
// missing path as already-gone. Production wires the real `node:fs/promises`.

export interface SyncFs {
	/** Recursively creates `path` (like `mkdir -p`); a no-op if it exists. */
	mkdir(path: string): Promise<void>;
	/** Directory entry names, or `[]` when the directory doesn't exist. */
	readDir(path: string): Promise<string[]>;
	/** File contents, or `null` when the file doesn't exist (never throws
	 * ENOENT — a missing CLAUDE.md/.mcp.json is the normal first-sync case). */
	readFile(path: string): Promise<string | null>;
	/** Recursively removes `path`; a missing path is not an error. */
	rm(path: string): Promise<void>;
	writeFile(path: string, content: string): Promise<void>;
}

/** The two directory roots the sync writes under. Injected so a test points
 * them at a scratch dir (or a fake) instead of the real home directory. */
export interface SyncRoots {
	/** `~/.better-agent` — holds `profile-state.json`. */
	betterAgentDir: string;
	/** `~/.claude` — holds `CLAUDE.md`, `skills/`, `.mcp.json`. */
	claudeDir: string;
}

function isEnoent(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

/** The real filesystem, used outside tests. */
export function defaultSyncFs(): SyncFs {
	return {
		mkdir: async (path) => {
			await mkdir(path, { recursive: true });
		},
		readDir: async (path) => {
			try {
				return await readdir(path);
			} catch (error) {
				if (isEnoent(error)) {
					return [];
				}
				throw error;
			}
		},
		readFile: async (path) => {
			try {
				return await readFile(path, "utf8");
			} catch (error) {
				if (isEnoent(error)) {
					return null;
				}
				throw error;
			}
		},
		rm: async (path) => {
			await rm(path, { force: true, recursive: true });
		},
		writeFile: async (path, content) => {
			await writeFile(path, content);
		},
	};
}

export function defaultSyncRoots(): SyncRoots {
	return {
		betterAgentDir: join(homedir(), ".better-agent"),
		claudeDir: join(homedir(), ".claude"),
	};
}
