import { describe, expect, it } from "vitest";
import {
	projectCheckoutDir,
	projectIndexPath,
	readProjectIndex,
	repoShortName,
	resolveProjectPath,
	writeProjectIndexEntry,
} from "./project-dir";

// Q2: checkout-directory naming (`<projectId[:8]>-<repo short name>`) and the
// projects/index.json projectId → localPath record the launch and query paths
// resolve through.

const PROJECT_ID = "0a1b2c3d-9999-4444-8888-121212121212";

/** An in-memory single-file fs for the index helpers. */
function memoryIndexFs(initial?: string) {
	const files = new Map<string, string>();
	if (initial !== undefined) {
		files.set(projectIndexPath("/base"), initial);
	}
	return {
		files,
		deps: {
			mkdirRecursive: () => Promise.resolve(),
			readTextFile: (path: string) => {
				const content = files.get(path);
				return content === undefined
					? Promise.reject(
							Object.assign(new Error("ENOENT"), { code: "ENOENT" })
						)
					: Promise.resolve(content);
			},
			writeTextFile: (path: string, content: string) => {
				files.set(path, content);
				return Promise.resolve();
			},
		},
	};
}

describe("project checkout naming", () => {
	it("derives <projectId[:8]>-<repo short name> under <base>/projects", () => {
		expect(
			projectCheckoutDir(
				"/base",
				PROJECT_ID,
				"https://github.com/acme/better-agent.git"
			)
		).toBe("/base/projects/0a1b2c3d-better-agent");
	});

	it("sanitizes odd clone URLs and falls back to 'repo'", () => {
		expect(repoShortName("https://github.com/acme/We ird$name.git/")).toBe(
			"We-ird-name"
		);
		expect(repoShortName("https://github.com/acme/.git")).toBe("repo");
	});
});

describe("project index", () => {
	it("round-trips entries through index.json", async () => {
		const fs = memoryIndexFs();
		await writeProjectIndexEntry(
			"/base",
			PROJECT_ID,
			"/base/projects/a",
			fs.deps
		);
		await writeProjectIndexEntry(
			"/base",
			"other-id",
			"/base/projects/b",
			fs.deps
		);
		expect(await resolveProjectPath("/base", PROJECT_ID, fs.deps)).toBe(
			"/base/projects/a"
		);
		expect(await readProjectIndex("/base", fs.deps)).toEqual({
			[PROJECT_ID]: "/base/projects/a",
			"other-id": "/base/projects/b",
		});
	});

	it("treats a missing or corrupt index as empty", async () => {
		expect(await readProjectIndex("/base", memoryIndexFs().deps)).toEqual({});
		expect(
			await readProjectIndex("/base", memoryIndexFs("not json").deps)
		).toEqual({});
		expect(
			await resolveProjectPath("/base", PROJECT_ID, memoryIndexFs("[1]").deps)
		).toBeNull();
	});
});
