import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectQueryCommand } from "@better-agent/agent/project-ports";
import { describe, expect, it } from "vitest";
import {
	createProjectQueryHandler,
	type ProjectQuerySubmitInput,
} from "./project-query";
import type { GitExecResult } from "./repo-cache";

// Q2: the CLI query executor — fs_list confined to the checkout (dirs-first,
// .git omitted), git_status parsed off porcelain v1, and every failure
// submitted as an ok:false answer carrying the real error.

const PROJECT_ID = "0a1b2c3d-9999-4444-8888-121212121212";

function queryCommand(
	overrides: Partial<ProjectQueryCommand> = {}
): ProjectQueryCommand {
	return {
		kind: "project_query",
		op: "fs_list",
		projectId: PROJECT_ID,
		requestId: "req-1",
		...overrides,
	};
}

async function checkoutDir(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "ba-project-query-"));
	await mkdir(join(root, ".git"));
	await mkdir(join(root, "src"));
	await writeFile(join(root, "README.md"), "hello");
	await writeFile(join(root, "a.txt"), "aa");
	return root;
}

function rig(root: string | null, gitResults: GitExecResult[] = []) {
	const submitted: ProjectQuerySubmitInput[] = [];
	const logs: string[] = [];
	const handler = createProjectQueryHandler({
		basePath: "/base",
		exec: () => {
			const next = gitResults.shift();
			return Promise.resolve(
				next ?? { code: 1, stderr: "no result", stdout: "" }
			);
		},
		log: (message) => logs.push(message),
		readTextFile: () =>
			root === null
				? Promise.reject(new Error("ENOENT"))
				: Promise.resolve(JSON.stringify({ [PROJECT_ID]: root })),
		submitResult: (input) => {
			submitted.push(input);
			return Promise.resolve({ ok: true });
		},
	});
	return { handler, logs, submitted };
}

const CLEAN_STATUS: GitExecResult = {
	code: 0,
	stderr: "",
	stdout: "## main...origin/main\n",
};

describe("project query - fs_list", () => {
	it("lists dirs first, alpha, sizes for files, .git omitted", async () => {
		const root = await checkoutDir();
		const context = rig(root);
		await context.handler.handle(queryCommand());
		expect(context.submitted).toEqual([
			{
				ok: true,
				requestId: "req-1",
				result: {
					entries: [
						{ kind: "dir", name: "src" },
						{ kind: "file", name: "a.txt", size: 2 },
						{ kind: "file", name: "README.md", size: 5 },
					],
				},
			},
		]);
	});

	it("answers an escaping path with the confinement error", async () => {
		const root = await checkoutDir();
		const context = rig(root);
		await context.handler.handle(queryCommand({ path: "../outside" }));
		expect(context.submitted).toEqual([
			{
				errorMessage: "path escapes the workspace",
				ok: false,
				requestId: "req-1",
			},
		]);
	});

	it("answers an unknown project with the real cause", async () => {
		const context = rig(null);
		await context.handler.handle(queryCommand());
		expect(context.submitted[0]).toEqual({
			errorMessage: "project is not cloned on this computer",
			ok: false,
			requestId: "req-1",
		});
	});
});

describe("project query - git_status", () => {
	it("parses porcelain into branch, dirty changes and the last commit", async () => {
		const root = await checkoutDir();
		const context = rig(root, [
			{
				code: 0,
				stderr: "",
				stdout:
					'## main...origin/main [ahead 1]\n M src/app.ts\n?? "b c.txt"\n',
			},
			{ code: 0, stderr: "", stdout: "abc123\u001ffix: login flake\n" },
		]);
		await context.handler.handle(queryCommand({ op: "git_status" }));
		expect(context.submitted[0]).toEqual({
			ok: true,
			requestId: "req-1",
			result: {
				branch: "main",
				changes: [
					{ path: "src/app.ts", status: " M" },
					{ path: "b c.txt", status: "??" },
				],
				dirty: true,
				lastCommit: { hash: "abc123", subject: "fix: login flake" },
			},
		});
	});

	it("reports a clean detached HEAD with a null branch", async () => {
		const root = await checkoutDir();
		const context = rig(root, [
			{ code: 0, stderr: "", stdout: "## HEAD (no branch)\n" },
			{ code: 0, stderr: "", stdout: "abc123\u001fdetached\n" },
		]);
		await context.handler.handle(queryCommand({ op: "git_status" }));
		expect(context.submitted[0]).toMatchObject({
			ok: true,
			result: { branch: null, changes: [], dirty: false },
		});
	});
});

describe("project query - git_status edge cases", () => {
	it("answers null lastCommit for an empty repository", async () => {
		const root = await checkoutDir();
		const context = rig(root, [
			CLEAN_STATUS,
			{ code: 128, stderr: "fatal: no commits", stdout: "" },
		]);
		await context.handler.handle(queryCommand({ op: "git_status" }));
		expect(context.submitted[0]).toMatchObject({
			ok: true,
			result: { lastCommit: null },
		});
	});

	it("answers a git failure with the real stderr", async () => {
		const root = await checkoutDir();
		const context = rig(root, [
			{ code: 128, stderr: "fatal: not a git repository", stdout: "" },
		]);
		await context.handler.handle(queryCommand({ op: "git_status" }));
		expect(context.submitted[0]).toEqual({
			errorMessage: "git status failed: fatal: not a git repository",
			ok: false,
			requestId: "req-1",
		});
	});
});
