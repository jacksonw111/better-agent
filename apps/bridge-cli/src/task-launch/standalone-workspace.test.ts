import { describe, expect, it, vi } from "vitest";
import { prepareRunWorkspace, standaloneTaskDir } from "./standalone-workspace";

// S25-T1 (design D5): a stand-alone Run works in the clean managed directory
// `~/.better-agent/tasks/<taskId>/`. Creation is recursive AND idempotent —
// a retry's new Run reuses the SAME task directory, never a fresh one — and
// a repository workspace intent fails with the S4-T3 placeholder error
// instead of pretending to prepare anything.

const HOME = "/home/tester";
const TASK_ID = "3f2b8a10-0000-4000-8000-000000000001";

function fakeDeps() {
	const created: string[] = [];
	return {
		created,
		deps: {
			homeDir: () => HOME,
			mkdirRecursive: vi.fn((path: string) => {
				created.push(path);
				return Promise.resolve();
			}),
		},
	};
}

describe("standaloneTaskDir", () => {
	it("is ~/.better-agent/tasks/<taskId>", () => {
		expect(standaloneTaskDir(HOME, TASK_ID)).toBe(
			`${HOME}/.better-agent/tasks/${TASK_ID}`
		);
	});
});

describe("prepareRunWorkspace - standalone", () => {
	it("creates the managed task directory recursively and returns it", async () => {
		const { deps, created } = fakeDeps();
		const path = await prepareRunWorkspace(
			{ taskId: TASK_ID, workspace: { kind: "standalone" } },
			deps
		);
		expect(path).toBe(`${HOME}/.better-agent/tasks/${TASK_ID}`);
		expect(created).toEqual([path]);
	});

	it("reuses the same task directory for a retry's new Run", async () => {
		const { deps } = fakeDeps();
		const command = {
			taskId: TASK_ID,
			workspace: { kind: "standalone" as const },
		};
		const first = await prepareRunWorkspace(command, deps);
		const second = await prepareRunWorkspace(command, deps);
		expect(second).toBe(first);
		expect(deps.mkdirRecursive).toHaveBeenCalledTimes(2);
	});

	it("propagates the real mkdir error", async () => {
		const { deps } = fakeDeps();
		deps.mkdirRecursive.mockRejectedValueOnce(
			new Error("EACCES: permission denied, mkdir")
		);
		await expect(
			prepareRunWorkspace(
				{ taskId: TASK_ID, workspace: { kind: "standalone" } },
				deps
			)
		).rejects.toThrow("EACCES: permission denied, mkdir");
	});
});

describe("prepareRunWorkspace - repository placeholder", () => {
	it("fails with the S4-T3 placeholder instead of preparing anything", async () => {
		const { deps } = fakeDeps();
		await expect(
			prepareRunWorkspace(
				{
					taskId: TASK_ID,
					workspace: {
						cloneUrl: "https://github.com/a/b.git",
						defaultBranch: "main",
						fullName: "a/b",
						kind: "repository",
					},
				},
				deps
			)
		).rejects.toThrow("repository workspaces land in S4-T3");
		expect(deps.mkdirRecursive).not.toHaveBeenCalled();
	});
});
