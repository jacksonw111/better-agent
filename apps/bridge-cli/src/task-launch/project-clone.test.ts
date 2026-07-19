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
/** One ack for the original delivery, one for the redelivered command. */
const ACKED_TWICE = 2;

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

describe("clone handler - url shapes", () => {
	it("injects the one-time token for an https URL on any host", async () => {
		const context = rig();
		await context.handler.handle(
			command({ repoCloneUrl: "https://gitlab.example.com/group/repo.git" })
		);

		expect(context.gitCalls[0]).toEqual([
			"clone",
			`https://x-access-token:${TOKEN}@gitlab.example.com/group/repo.git`,
			"/base/projects/0a1b2c3d-repo",
		]);
		expect(context.gitCalls[1]).toEqual([
			"-C",
			"/base/projects/0a1b2c3d-repo",
			"remote",
			"set-url",
			"origin",
			"https://gitlab.example.com/group/repo.git",
		]);
	});

	it("clones an ssh remote as-is: the token is ignored, origin never rewritten", async () => {
		const context = rig();
		await context.handler.handle(
			command({ repoCloneUrl: "git@git.company.io:group/repo.git" })
		);

		// ssh auth is this machine's own ssh keys — the token never enters the
		// URL, so there is nothing to rewrite afterwards either.
		expect(context.gitCalls).toEqual([
			[
				"clone",
				"git@git.company.io:group/repo.git",
				"/base/projects/0a1b2c3d-repo",
			],
		]);
		expect(context.reports[0]).toMatchObject({ status: "ready" });
		expect(JSON.stringify(context.gitCalls)).not.toContain(TOKEN);
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

	it("in-flight duplicates collapse to one ack; settled ones defer to the server", async () => {
		const context = rig();
		// The two delivery channels racing the same command: one ack, one clone.
		await Promise.all([
			context.handler.handle(command()),
			context.handler.handle(command()),
		]);
		expect(context.ackClone).toHaveBeenCalledTimes(1);
		expect(context.gitCalls.filter((args) => args[0] === "clone")).toHaveLength(
			1
		);

		// Once settled the SERVER ack is the idempotency source: a redelivery is
		// acked again and its ok:false stops the clone.
		context.ackClone.mockResolvedValueOnce({ ok: false });
		await context.handler.handle(command());
		expect(context.ackClone).toHaveBeenCalledTimes(ACKED_TWICE);
		expect(context.gitCalls.filter((args) => args[0] === "clone")).toHaveLength(
			1
		);
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

describe("clone handler - retry", () => {
	it("a failed clone can be retried in the same process once the server re-queues it", async () => {
		// projects.retryClone / a repo edit reset the row to `created`, so the
		// SAME projectId is redelivered — the seen set must not swallow it.
		const options = { failClone: "fatal: could not read Username" } as {
			failClone?: string;
		};
		const context = rig(options);
		await context.handler.handle(command({ token: undefined }));
		expect(context.reports[0]).toMatchObject({ status: "error" });

		options.failClone = undefined;
		await context.handler.handle(command({ token: undefined }));
		expect(context.ackClone).toHaveBeenCalledTimes(ACKED_TWICE);
		expect(context.reports[1]).toMatchObject({ status: "ready" });
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
