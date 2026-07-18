import type { ProjectCloneCommand } from "@better-agent/agent/project-ports";
import { describe, expect, it, vi } from "vitest";
import { type CloneResultInput, createCloneHandler } from "./project-clone";
import type { GitExecResult } from "./repo-cache";

// Q2: the clone_project processor — ack-first idempotency (seen set + server
// ok:false), one-time token use (credentialed clone URL, remote rewritten
// token-free, token never logged or reported), existing-checkout redelivery
// re-reporting ready, and failures reporting the real (scrubbed) stderr.

const TOKEN = "ghp_secret_token_value";
const EXPECTED_DIR = "/base/projects/0a1b2c3d-better-agent";

function command(
	overrides: Partial<ProjectCloneCommand> = {}
): ProjectCloneCommand {
	return {
		kind: "clone_project",
		projectId: "0a1b2c3d-9999-4444-8888-121212121212",
		repoCloneUrl: "https://github.com/acme/better-agent.git",
		token: TOKEN,
		...overrides,
	};
}

function rig(options: { existing?: boolean; failClone?: string } = {}) {
	const gitCalls: string[][] = [];
	const files = new Map<string, string>();
	const reports: CloneResultInput[] = [];
	const logs: string[] = [];
	const ackClone = vi.fn(() => Promise.resolve({ ok: true }));
	const handler = createCloneHandler({
		ackClone,
		basePath: "/base",
		exec: (args: string[]): Promise<GitExecResult> => {
			gitCalls.push(args);
			if (args[0] === "clone" && options.failClone !== undefined) {
				return Promise.resolve({
					code: 128,
					stderr: options.failClone,
					stdout: "",
				});
			}
			return Promise.resolve({ code: 0, stderr: "", stdout: "" });
		},
		exists: (path: string) =>
			Promise.resolve(Boolean(options.existing) && path.endsWith("/.git")),
		log: (message) => logs.push(message),
		mkdirRecursive: () => Promise.resolve(),
		readTextFile: (path: string) => {
			const content = files.get(path);
			return content === undefined
				? Promise.reject(new Error("ENOENT"))
				: Promise.resolve(content);
		},
		reportCloneResult: (input) => {
			reports.push(input);
			return Promise.resolve({ ok: true });
		},
		writeTextFile: (path: string, content: string) => {
			files.set(path, content);
			return Promise.resolve();
		},
	});
	return { ackClone, files, gitCalls, handler, logs, reports };
}

describe("clone handler - happy path", () => {
	it("acks, clones with the one-time token URL, rewrites origin token-free", async () => {
		const context = rig();
		await context.handler.handle(command());

		expect(context.ackClone).toHaveBeenCalledExactlyOnceWith(
			command().projectId
		);
		expect(context.gitCalls[0]).toEqual([
			"clone",
			`https://x-access-token:${TOKEN}@github.com/acme/better-agent.git`,
			EXPECTED_DIR,
		]);
		expect(context.gitCalls[1]).toEqual([
			"-C",
			EXPECTED_DIR,
			"remote",
			"set-url",
			"origin",
			"https://github.com/acme/better-agent.git",
		]);
		expect(context.reports).toEqual([
			{
				localPath: EXPECTED_DIR,
				projectId: command().projectId,
				status: "ready",
			},
		]);
	});

	it("records projectId → localPath in the index and never logs the token", async () => {
		const context = rig();
		await context.handler.handle(command());

		expect(context.files.get("/base/projects/index.json")).toContain(
			`"${command().projectId}": "${EXPECTED_DIR}"`
		);
		expect(JSON.stringify(context.logs)).not.toContain(TOKEN);
	});

	it("clones a token-less public repo with the plain URL and no rewrite", async () => {
		const context = rig();
		await context.handler.handle(command({ token: undefined }));

		expect(context.gitCalls).toEqual([
			["clone", "https://github.com/acme/better-agent.git", EXPECTED_DIR],
		]);
		expect(context.reports[0]).toMatchObject({ status: "ready" });
	});
});

describe("clone handler - idempotency", () => {
	it("re-reports ready for an existing checkout without running git", async () => {
		const context = rig({ existing: true });
		await context.handler.handle(command());

		expect(context.gitCalls).toEqual([]);
		expect(context.reports).toEqual([
			{
				localPath: EXPECTED_DIR,
				projectId: command().projectId,
				status: "ready",
			},
		]);
	});

	it("the seen set and the server ack both stop duplicate clones", async () => {
		const context = rig();
		await context.handler.handle(command());
		await context.handler.handle(command());
		expect(context.ackClone).toHaveBeenCalledTimes(1);

		const redelivered = rig();
		redelivered.ackClone.mockResolvedValueOnce({ ok: false });
		await redelivered.handler.handle(command());
		expect(redelivered.gitCalls).toEqual([]);
		expect(redelivered.reports).toEqual([]);
	});

	it("a failed ack clears the seen mark so redelivery retries", async () => {
		const context = rig();
		context.ackClone.mockRejectedValueOnce(new Error("network down"));
		await context.handler.handle(command());
		expect(context.reports).toEqual([]);

		await context.handler.handle(command());
		expect(context.reports[0]).toMatchObject({ status: "ready" });
	});
});

describe("clone handler - failure", () => {
	it("reports the real stderr with the token scrubbed", async () => {
		const context = rig({
			failClone: `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/acme/better-agent.git': 403`,
		});
		await context.handler.handle(command());

		expect(context.reports).toHaveLength(1);
		const report = context.reports[0];
		if (report?.status !== "error") {
			throw new Error("expected an error report");
		}
		expect(report.errorMessage).toContain("403");
		expect(report.errorMessage).toContain("***");
		expect(JSON.stringify(context.reports)).not.toContain(TOKEN);
	});
});
