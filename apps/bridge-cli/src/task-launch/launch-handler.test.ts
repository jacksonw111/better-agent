import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import { describe, expect, it, vi } from "vitest";
import {
	createLaunchHandler,
	type LaunchHandlerDeps,
	type StartedRunSession,
} from "./launch-handler";

// S25-T1: the single launch processor behind BOTH delivery channels
// (/computer-ws push and heartbeat pendingCommands). Idempotency is
// double-locked — an in-process seen set AND the server's ackLaunch ok:false
// — so the same runId never starts a second runtime process (§15.3). Every
// failure reports `failed` with the REAL error; a clean session end reports
// `stopped`.

const RUN_ID = "9a1f0e00-0000-4000-8000-00000000run1";
const TASK_ID = "5b2c1d00-0000-4000-8000-0000000task1";

function launchCommand(
	overrides: Partial<RunLaunchCommand> = {}
): RunLaunchCommand {
	return {
		agentKind: "claude-code",
		description: "Do the thing",
		issueSnapshots: [],
		kind: "launch",
		repositoryUrl: null,
		runId: RUN_ID,
		sessionCredential: "bt_secret",
		taskId: TASK_ID,
		workspace: { kind: "standalone" },
		...overrides,
	};
}

function controllableSession(): StartedRunSession & {
	rejectDone: (error: Error) => void;
	resolveDone: () => void;
} {
	let resolveDone!: () => void;
	let rejectDone!: (error: Error) => void;
	const done = new Promise<void>((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});
	return { done, rejectDone, resolveDone };
}

function fakeDeps(overrides: Partial<LaunchHandlerDeps> = {}) {
	const statuses: { errorMessage?: string; status?: string }[] = [];
	const deps: LaunchHandlerDeps = {
		ackLaunch: vi.fn(() => Promise.resolve({ ok: true })),
		buildStartContext: vi.fn(() => Promise.resolve("START CONTEXT")),
		log: vi.fn(),
		prepareWorkspace: vi.fn(() => Promise.resolve("/ws/task-1")),
		runSession: vi.fn(() => {
			const session = controllableSession();
			session.resolveDone();
			return Promise.resolve(session);
		}),
		signal: new AbortController().signal,
		updateRunStatus: vi.fn((update) => {
			statuses.push({
				errorMessage: update.errorMessage,
				status: update.status,
			});
			return Promise.resolve({ ok: true });
		}),
		...overrides,
	};
	return { deps, statuses };
}

describe("launch handler - success chain", () => {
	it("reports preparing_workspace → starting_runtime(workspacePath) → running → stopped", async () => {
		const { deps, statuses } = fakeDeps();
		await createLaunchHandler(deps).handle(launchCommand());

		expect(deps.updateRunStatus).toHaveBeenNthCalledWith(1, {
			runId: RUN_ID,
			status: "preparing_workspace",
		});
		expect(deps.updateRunStatus).toHaveBeenNthCalledWith(2, {
			runId: RUN_ID,
			status: "starting_runtime",
			workspacePath: "/ws/task-1",
		});
		expect(statuses.map((entry) => entry.status)).toEqual([
			"preparing_workspace",
			"starting_runtime",
			"running",
			"stopped",
		]);
		expect(deps.runSession).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				agentKind: "claude-code",
				runId: RUN_ID,
				sessionCredential: "bt_secret",
				startContext: "START CONTEXT",
				taskId: TASK_ID,
				workspacePath: "/ws/task-1",
			})
		);
	});
});

describe("launch handler - start context assembly (P2)", () => {
	it("a resume launch never assembles a start context and threads the resume id", async () => {
		const { deps } = fakeDeps();
		await createLaunchHandler(deps).handle(
			launchCommand({ resumeAgentSessionId: "conv-42" })
		);
		expect(deps.buildStartContext).not.toHaveBeenCalled();
		expect(deps.runSession).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				resumeAgentSessionId: "conv-42",
				startContext: "",
			})
		);
	});

	it("a cold start with an empty description skips the start context", async () => {
		const { deps } = fakeDeps();
		await createLaunchHandler(deps).handle(launchCommand({ description: "" }));
		expect(deps.buildStartContext).not.toHaveBeenCalled();
		expect(deps.runSession).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ startContext: "" })
		);
	});

	it("a whitespace-only description counts as empty", async () => {
		const { deps } = fakeDeps();
		await createLaunchHandler(deps).handle(
			launchCommand({ description: "  \n\t " })
		);
		expect(deps.buildStartContext).not.toHaveBeenCalled();
	});
});

describe("launch handler - idempotency", () => {
	it("processes a runId arriving on both channels concurrently exactly once", async () => {
		const { deps } = fakeDeps();
		const handler = createLaunchHandler(deps);
		await Promise.all([
			handler.handle(launchCommand()),
			handler.handle(launchCommand()),
		]);
		expect(deps.ackLaunch).toHaveBeenCalledTimes(1);
		expect(deps.runSession).toHaveBeenCalledTimes(1);
	});

	it("skips a launch the server says was already acked (ok:false)", async () => {
		const { deps } = fakeDeps({
			ackLaunch: vi.fn(() => Promise.resolve({ ok: false })),
		});
		await createLaunchHandler(deps).handle(launchCommand());
		expect(deps.updateRunStatus).not.toHaveBeenCalled();
		expect(deps.runSession).not.toHaveBeenCalled();
	});

	it("clears the seen mark when the ack itself fails, so redelivery retries", async () => {
		const { deps } = fakeDeps();
		const ackLaunch = deps.ackLaunch as ReturnType<typeof vi.fn>;
		ackLaunch.mockRejectedValueOnce(new Error("network down"));
		const handler = createLaunchHandler(deps);

		await handler.handle(launchCommand());
		expect(deps.runSession).not.toHaveBeenCalled();

		await handler.handle(launchCommand());
		expect(deps.ackLaunch).toHaveBeenCalledTimes(2);
		expect(deps.runSession).toHaveBeenCalledTimes(1);
	});
});

describe("launch handler - failures report the real error", () => {
	it("workspace preparation failure → failed, session never started", async () => {
		const { deps, statuses } = fakeDeps({
			prepareWorkspace: vi.fn(() =>
				Promise.reject(new Error("EACCES: permission denied, mkdir"))
			),
		});
		await createLaunchHandler(deps).handle(launchCommand());
		expect(statuses).toEqual([
			{ errorMessage: undefined, status: "preparing_workspace" },
			{
				errorMessage: "EACCES: permission denied, mkdir",
				status: "failed",
			},
		]);
		expect(deps.runSession).not.toHaveBeenCalled();
	});

	it("runtime/relay startup failure → failed with the adapter's real error", async () => {
		const { deps, statuses } = fakeDeps({
			runSession: vi.fn(() => Promise.reject(new Error("spawn claude ENOENT"))),
		});
		await createLaunchHandler(deps).handle(launchCommand());
		expect(statuses.at(-1)).toEqual({
			errorMessage: "spawn claude ENOENT",
			status: "failed",
		});
		expect(statuses.map((entry) => entry.status)).not.toContain("running");
	});

	it("session error exit after running → failed with the real error", async () => {
		const session = controllableSession();
		const { deps, statuses } = fakeDeps({
			runSession: vi.fn(() => Promise.resolve(session)),
		});
		const pending = createLaunchHandler(deps).handle(launchCommand());
		session.rejectDone(new Error("agent process crashed (exit 1)"));
		await pending;
		expect(statuses.map((entry) => entry.status)).toEqual([
			"preparing_workspace",
			"starting_runtime",
			"running",
			"failed",
		]);
		expect(statuses.at(-1)?.errorMessage).toBe(
			"agent process crashed (exit 1)"
		);
	});
});

// S4-T3: repository workspace preparation (and its failure → `failed` with
// the real git stderr) is covered in repo-workspace.test.ts, including a
// launch-handler integration test — the placeholder failure is gone.

describe("launch handler - settle", () => {
	it("waits for every in-flight run session to wind down", async () => {
		const session = controllableSession();
		const { deps, statuses } = fakeDeps({
			runSession: vi.fn(() => Promise.resolve(session)),
		});
		const handler = createLaunchHandler(deps);
		const pending = handler.handle(launchCommand());

		let settled = false;
		const settling = handler.settle().then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		session.resolveDone();
		await Promise.all([pending, settling]);
		expect(settled).toBe(true);
		expect(statuses.at(-1)?.status).toBe("stopped");
	});
});
