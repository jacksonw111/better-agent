import { describe, expect, it } from "vitest";
import { projectIndexPath } from "./project-dir";
import { prepareProjectRunWorkspace } from "./project-workspace";

// Q2: project sessions run in the recorded checkout — a pure index lookup,
// no per-session workspace. A machine without a live checkout fails the Run
// with the real "not cloned on this computer" cause.

const PROJECT_ID = "0a1b2c3d-9999-4444-8888-121212121212";
const LOCAL_PATH = "/base/projects/0a1b2c3d-app";

function deps(index: Record<string, string> | null, dirExists = true) {
	return {
		basePath: "/base",
		exists: (path: string) => Promise.resolve(dirExists && path === LOCAL_PATH),
		readTextFile: (path: string) =>
			index !== null && path === projectIndexPath("/base")
				? Promise.resolve(JSON.stringify(index))
				: Promise.reject(new Error("ENOENT")),
	};
}

describe("prepareProjectRunWorkspace", () => {
	it("resolves the recorded checkout as the session cwd", async () => {
		await expect(
			prepareProjectRunWorkspace(
				{ kind: "project", projectId: PROJECT_ID },
				deps({ [PROJECT_ID]: LOCAL_PATH })
			)
		).resolves.toBe(LOCAL_PATH);
	});

	it("fails with the real cause when the project was never cloned here", async () => {
		await expect(
			prepareProjectRunWorkspace(
				{ kind: "project", projectId: PROJECT_ID },
				deps(null)
			)
		).rejects.toThrow(
			`Project ${PROJECT_ID} is not cloned on this computer — wait for the clone to finish or recreate the project`
		);
	});

	it("fails when the recorded directory no longer exists", async () => {
		await expect(
			prepareProjectRunWorkspace(
				{ kind: "project", projectId: PROJECT_ID },
				deps({ [PROJECT_ID]: LOCAL_PATH }, false)
			)
		).rejects.toThrow("not cloned on this computer");
	});
});
