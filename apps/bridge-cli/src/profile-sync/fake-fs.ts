import { sep } from "node:path";
import type { SyncFs } from "./fs-ports";

// A minimal in-memory SyncFs for the sync tests: a flat map of path → contents,
// with directories tracked as a set. It mirrors the forgiving contract of the
// real `defaultSyncFs` (readFile→null / readDir→[] on a miss, rm is recursive)
// so a test exercises the exact code paths production hits, no disk involved.

const SEPARATOR = sep === "\\" ? "\\" : "/";
const PATH_SPLIT = /[\\/]+/;

export interface FakeFs extends SyncFs {
	/** Test assertions: the current file contents at `path`, or undefined. */
	get(path: string): string | undefined;
	/** Test assertions: every path currently present (files only). */
	paths(): string[];
}

function normalize(path: string): string {
	return path.split(PATH_SPLIT).join(SEPARATOR);
}

function isUnder(child: string, parent: string): boolean {
	return child === parent || child.startsWith(`${parent}${SEPARATOR}`);
}

export function createFakeFs(seed: Record<string, string> = {}): FakeFs {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	for (const [path, content] of Object.entries(seed)) {
		files.set(normalize(path), content);
	}
	return {
		get: (path) => files.get(normalize(path)),
		mkdir: (path) => {
			dirs.add(normalize(path));
			return Promise.resolve();
		},
		paths: () => [...files.keys()],
		readDir: (path) => {
			const prefix = `${normalize(path)}${SEPARATOR}`;
			const names = new Set<string>();
			for (const key of [...files.keys(), ...dirs]) {
				if (key.startsWith(prefix)) {
					const rest = key.slice(prefix.length).split(SEPARATOR)[0];
					if (rest) {
						names.add(rest);
					}
				}
			}
			return Promise.resolve([...names]);
		},
		readFile: (path) => Promise.resolve(files.get(normalize(path)) ?? null),
		rm: (path) => {
			const target = normalize(path);
			for (const key of [...files.keys()]) {
				if (isUnder(key, target)) {
					files.delete(key);
				}
			}
			for (const key of [...dirs]) {
				if (isUnder(key, target)) {
					dirs.delete(key);
				}
			}
			return Promise.resolve();
		},
		writeFile: (path, content) => {
			files.set(normalize(path), content);
			return Promise.resolve();
		},
	};
}
