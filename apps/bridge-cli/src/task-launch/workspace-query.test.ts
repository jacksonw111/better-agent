import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceQueryCommand } from "@better-agent/agent/project-ports";
import { describe, expect, it } from "vitest";
import type { ProjectQuerySubmitInput } from "./project-query";
import {
	createWorkspaceQueryHandler,
	type WorkspaceShellRunner,
} from "./workspace-query";

// DP-WS: the CLI workspace-query executor — fs_list/git_status resolved against
// the session's workspace root (an explicit dir, or the home dir for ""), and a
// BOUNDED shell op. Every failure is an ok:false answer carrying the real error.

async function workspaceDir(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "ba-workspace-query-"));
	await mkdir(join(root, ".git"));
	await mkdir(join(root, "src"));
	await writeFile(join(root, "README.md"), "hello");
	return root;
}

function command(
	overrides: Partial<WorkspaceQueryCommand>
): WorkspaceQueryCommand {
	return {
		kind: "workspace_query",
		op: "fs_list",
		requestId: "req-1",
		workspaceRoot: "",
		...overrides,
	};
}

function rig(
	options: { homeDir?: string; runShell?: WorkspaceShellRunner } = {}
) {
	const submitted: ProjectQuerySubmitInput[] = [];
	const handler = createWorkspaceQueryHandler({
		homeDir: options.homeDir ? () => options.homeDir as string : undefined,
		log: () => undefined,
		runShell: options.runShell,
		submitResult: (input) => {
			submitted.push(input);
			return Promise.resolve({ ok: true });
		},
	});
	return { handler, submitted };
}

describe("workspace query - fs_list", () => {
	it("lists the workspace root's entries (dirs first, .git omitted)", async () => {
		const root = await workspaceDir();
		const context = rig();
		await context.handler.handle(
			command({ op: "fs_list", workspaceRoot: root })
		);
		expect(context.submitted).toEqual([
			{
				ok: true,
				requestId: "req-1",
				result: {
					entries: [
						{ kind: "dir", name: "src" },
						{ kind: "file", name: "README.md", size: 5 },
					],
				},
			},
		]);
	});

	it("resolves an empty workspaceRoot to the home dir", async () => {
		const root = await workspaceDir();
		const context = rig({ homeDir: root });
		await context.handler.handle(command({ op: "fs_list", workspaceRoot: "" }));
		expect(context.submitted[0]).toMatchObject({ ok: true });
	});

	it("answers an escaping path with the confinement error", async () => {
		const root = await workspaceDir();
		const context = rig();
		await context.handler.handle(
			command({ op: "fs_list", path: "../..", workspaceRoot: root })
		);
		expect(context.submitted[0]).toMatchObject({
			ok: false,
			requestId: "req-1",
		});
	});
});

describe("workspace query - shell", () => {
	it("runs the command in the workspace and returns its result", async () => {
		const root = await workspaceDir();
		let seenCwd = "";
		let seenCmd = "";
		const runShell: WorkspaceShellRunner = (cwd, cmd) => {
			seenCwd = cwd;
			seenCmd = cmd;
			return Promise.resolve({
				exitCode: 0,
				stderr: "",
				stdout: "hi\n",
				truncated: false,
			});
		};
		const context = rig({ runShell });
		await context.handler.handle(
			command({ cmd: "echo hi", op: "shell", workspaceRoot: root })
		);
		expect(seenCwd).toBe(root);
		expect(seenCmd).toBe("echo hi");
		expect(context.submitted[0]).toEqual({
			ok: true,
			requestId: "req-1",
			result: { exitCode: 0, stderr: "", stdout: "hi\n", truncated: false },
		});
	});

	it("runs a real command bounded in the workspace cwd", async () => {
		const root = await workspaceDir();
		const context = rig();
		await context.handler.handle(
			command({ cmd: "cat README.md", op: "shell", workspaceRoot: root })
		);
		const answer = context.submitted[0];
		expect(answer).toMatchObject({ ok: true });
		if (answer?.ok) {
			expect(answer.result).toMatchObject({ exitCode: 0, truncated: false });
			expect((answer.result as { stdout: string }).stdout).toContain("hello");
		}
	});

	it("answers ok:false when a shell op arrives with no command", async () => {
		const context = rig();
		await context.handler.handle(command({ op: "shell", workspaceRoot: "/x" }));
		expect(context.submitted[0]).toMatchObject({ ok: false });
	});
});
