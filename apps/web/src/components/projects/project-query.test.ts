import { afterEach, expect, it, vi } from "vitest";
import { projectFsListOptions, projectGitStatusOptions } from "./project-query";

// Q3 wrap-up: the query options now call the REAL `projects.query` endpoint
// through the generated router client (the Q3-era local cast is gone). The
// endpoint's output is a union (fs_list | git_status result) — each option
// must narrow to its own op's half and refuse the other shape.

const queryMock = vi.hoisted(() => vi.fn());

const GIT_MISMATCH_PATTERN = /git_status request with an fs_list result/;
const FS_MISMATCH_PATTERN = /fs_list request with a git_status result/;

vi.mock("@/utils/orpc", () => ({
	client: { projects: { query: queryMock } },
}));

const GIT_RESULT = {
	branch: "main",
	changes: [{ path: "src/index.ts", status: " M" }],
	dirty: true,
	lastCommit: { hash: "abc1234", subject: "feat: initial" },
};

const FS_RESULT = { entries: [{ kind: "dir", name: "src" }] };

afterEach(() => {
	queryMock.mockReset();
});

it("git_status options call projects.query and return the git result", async () => {
	queryMock.mockResolvedValue(GIT_RESULT);
	const options = projectGitStatusOptions("project-1");

	await expect(options.queryFn()).resolves.toEqual(GIT_RESULT);
	expect(queryMock).toHaveBeenCalledWith({
		op: "git_status",
		projectId: "project-1",
	});
	expect(options.queryKey).toEqual([
		"projects",
		"query",
		"project-1",
		"git_status",
	]);
});

it("git_status options refuse an fs_list-shaped answer", async () => {
	queryMock.mockResolvedValue(FS_RESULT);

	await expect(projectGitStatusOptions("project-1").queryFn()).rejects.toThrow(
		GIT_MISMATCH_PATTERN
	);
});

it("fs_list options omit the path for the root and pass it otherwise", async () => {
	queryMock.mockResolvedValue(FS_RESULT);

	await expect(
		projectFsListOptions("project-1", "").queryFn()
	).resolves.toEqual(FS_RESULT);
	expect(queryMock).toHaveBeenCalledWith({
		op: "fs_list",
		path: undefined,
		projectId: "project-1",
	});

	await projectFsListOptions("project-1", "src/utils").queryFn();
	expect(queryMock).toHaveBeenLastCalledWith({
		op: "fs_list",
		path: "src/utils",
		projectId: "project-1",
	});
});

it("fs_list options refuse a git_status-shaped answer", async () => {
	queryMock.mockResolvedValue(GIT_RESULT);

	await expect(projectFsListOptions("project-1", "").queryFn()).rejects.toThrow(
		FS_MISMATCH_PATTERN
	);
});
