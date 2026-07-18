import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "../adapters/async-queue";
import type { Adapter, AgentHandle } from "../adapters/types";
import type { NormalizedEvent } from "../normalize/types";
import type { RelayTransport } from "../relay-client";
import type { RunRestartLoopOptions } from "../restart-loop";
import {
	createRunSessionSupplier,
	type RunSessionRequest,
} from "./run-session";

// S25-T1: a Run's session reuses the EXISTING relay path — startSession with
// the pre-issued sessionCredential and the runId (S2-T2's two-way binding),
// adapter.start in the Task workspace, then the same restart-loop the
// pre-existing session mode drives. The Task Start Context is injected as the
// first user input through the same dispatch path web input takes, echoed to
// the relay as an origin-tagged user message event.

const TASK_ID = "5b2c1d00-aaaa-4000-8000-000000000001";
const RUN_ID = "9a1f0e00-bbbb-4000-8000-000000000002";
// A1: the reliable oob sender's first minted idempotency key for a session.
const OOB_FIRST_KEY = /^oob:\d+:1$/;

function fakeHandle(): AgentHandle {
	const events = createAsyncQueue<NormalizedEvent>();
	events.close();
	return {
		answerApproval: vi.fn(),
		events,
		send: vi.fn(),
		stop: vi.fn(),
	};
}

function fakeTransport(): RelayTransport {
	return {
		fetchConfig: vi.fn(),
		pollCommands: vi.fn(() => Promise.resolve([])),
		pushEvents: vi.fn(() => Promise.resolve()),
		startSession: vi.fn(() =>
			Promise.resolve({
				config: { appendSystemPrompt: "sys" },
				mcpServers: [],
				sessionId: "sess-1",
				skills: [],
			})
		),
	};
}

function request(
	overrides: Partial<RunSessionRequest> = {}
): RunSessionRequest {
	return {
		agentKind: "claude-code",
		runId: RUN_ID,
		sessionCredential: "bt_secret",
		signal: new AbortController().signal,
		startContext: "TASK START CONTEXT",
		taskId: TASK_ID,
		workspacePath: "/ws/task-1",
		...overrides,
	};
}

function fakeRig() {
	const handle = fakeHandle();
	const adapter: Adapter = { start: vi.fn(() => Promise.resolve(handle)) };
	const transport = fakeTransport();
	let finishLoop!: () => void;
	let failLoop!: (error: Error) => void;
	const runLoop = vi.fn(
		(_options: RunRestartLoopOptions) =>
			new Promise<void>((resolve, reject) => {
				finishLoop = resolve;
				failLoop = reject;
			})
	);
	const supplier = createRunSessionSupplier(
		{ serverUrl: "https://server.example" },
		{
			createTransport: vi.fn(() => transport),
			runLoop,
			selectAdapter: vi.fn(() => adapter),
		}
	);
	return {
		adapter,
		failLoop: (error: Error) => failLoop(error),
		finishLoop: () => finishLoop(),
		handle,
		runLoop,
		supplier,
		transport,
	};
}

describe("run session - relay binding", () => {
	it("starts the session with the credential, the runId and a task label", async () => {
		const rig = fakeRig();
		const session = await rig.supplier(request());
		expect(rig.transport.startSession).toHaveBeenCalledExactlyOnceWith({
			agentKind: "claude-code",
			label: "task:5b2c1d00",
			runId: RUN_ID,
		});
		rig.finishLoop();
		await session.done;
	});

	it("starts the adapter in the task workspace with the session's config", async () => {
		const rig = fakeRig();
		const session = await rig.supplier(request());
		expect(rig.adapter.start).toHaveBeenCalledExactlyOnceWith("/ws/task-1", {
			config: { appendSystemPrompt: "sys" },
			mcpServers: [],
			skills: [],
		});
		rig.finishLoop();
		await session.done;
	});
});

describe("run session - start context injection", () => {
	it("sends the context to the agent and echoes an origin-tagged user message", async () => {
		const rig = fakeRig();
		const session = await rig.supplier(request());
		expect(rig.handle.send).toHaveBeenCalledExactlyOnceWith(
			"TASK START CONTEXT"
		);
		await vi.waitFor(() => {
			expect(rig.transport.pushEvents).toHaveBeenCalledWith({
				events: [
					{
						kind: "message",
						origin: "task-start",
						role: "user",
						text: "TASK START CONTEXT",
					},
				],
				idempotencyKeys: [expect.stringMatching(OOB_FIRST_KEY)],
				sessionId: "sess-1",
			});
		});
		rig.finishLoop();
		await session.done;
	});

	it("skips the injection when the start context is empty (empty description)", async () => {
		const rig = fakeRig();
		const session = await rig.supplier(request({ startContext: "" }));
		expect(rig.handle.send).not.toHaveBeenCalled();
		expect(rig.transport.pushEvents).not.toHaveBeenCalled();
		rig.finishLoop();
		await session.done;
	});

	it("a failed echo push never fails the launch", async () => {
		const rig = fakeRig();
		(
			rig.transport.pushEvents as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error("relay hiccup"));
		const session = await rig.supplier(request());
		expect(rig.handle.send).toHaveBeenCalledTimes(1);
		rig.finishLoop();
		await session.done;
	});
});

describe("run session - resume (P2)", () => {
	for (const agentKind of ["claude-code", "codex"] as const) {
		it(`${agentKind}: passes the resume id to the adapter and skips the injection`, async () => {
			const rig = fakeRig();
			const session = await rig.supplier(
				request({ agentKind, resumeAgentSessionId: "conv-42" })
			);
			expect(rig.adapter.start).toHaveBeenCalledExactlyOnceWith("/ws/task-1", {
				config: { appendSystemPrompt: "sys" },
				mcpServers: [],
				resume: "conv-42",
				skills: [],
			});
			// The resumed conversation already carries its history — no re-injected
			// start context, even though the request's startContext is non-empty.
			expect(rig.handle.send).not.toHaveBeenCalled();
			expect(rig.transport.pushEvents).not.toHaveBeenCalled();
			rig.finishLoop();
			await session.done;
		});
	}

	it("seeds the restart loop's resume with the same id", async () => {
		const rig = fakeRig();
		const session = await rig.supplier(
			request({ resumeAgentSessionId: "conv-42" })
		);
		expect(rig.runLoop.mock.calls[0]?.[0]?.args).toMatchObject({
			resume: "conv-42",
		});
		rig.finishLoop();
		await session.done;
	});
});

describe("run session - resume on a runtime that cannot resume (P2)", () => {
	for (const agentKind of ["opencode", "pi"] as const) {
		it(`${agentKind}: cold-starts with a resume_failed notice instead of failing`, async () => {
			const rig = fakeRig();
			const session = await rig.supplier(
				request({ agentKind, resumeAgentSessionId: "conv-42" })
			);
			expect(rig.adapter.start).toHaveBeenCalledExactlyOnceWith("/ws/task-1", {
				config: { appendSystemPrompt: "sys" },
				mcpServers: [],
				resume: undefined,
				skills: [],
			});
			await vi.waitFor(() => {
				expect(rig.transport.pushEvents).toHaveBeenCalledExactlyOnceWith({
					events: [
						{
							detail: {
								reason: `${agentKind} cannot resume a prior conversation; started a fresh session in the same workspace`,
							},
							kind: "status",
							status: "resume_failed",
						},
					],
					idempotencyKeys: [expect.stringMatching(OOB_FIRST_KEY)],
					sessionId: "sess-1",
				});
			});
			expect(rig.handle.send).not.toHaveBeenCalled();
			rig.finishLoop();
			await session.done;
		});
	}

	it("a failed resume_failed push never fails the launch", async () => {
		const rig = fakeRig();
		(
			rig.transport.pushEvents as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error("relay hiccup"));
		const session = await rig.supplier(
			request({ agentKind: "pi", resumeAgentSessionId: "conv-42" })
		);
		rig.finishLoop();
		await expect(session.done).resolves.toBeUndefined();
	});
});

describe("run session - lifecycle", () => {
	it("done resolves when the session loop ends cleanly", async () => {
		const rig = fakeRig();
		const session = await rig.supplier(request());
		const loopOptions = rig.runLoop.mock.calls[0]?.[0];
		expect(loopOptions).toMatchObject({
			handle: rig.handle,
			sessionId: "sess-1",
			transport: rig.transport,
		});
		expect(loopOptions?.args).toMatchObject({
			agentKind: "claude-code",
			dir: "/ws/task-1",
			serverUrl: "https://server.example",
			token: "bt_secret",
		});
		rig.finishLoop();
		await expect(session.done).resolves.toBeUndefined();
	});

	it("done rejects with the loop's real error", async () => {
		const rig = fakeRig();
		const session = await rig.supplier(request());
		rig.failLoop(new Error("poll loop exploded"));
		await expect(session.done).rejects.toThrow("poll loop exploded");
	});

	it("rejects with the real error when startSession fails", async () => {
		const rig = fakeRig();
		(
			rig.transport.startSession as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error("401 revoked credential"));
		await expect(rig.supplier(request())).rejects.toThrow(
			"401 revoked credential"
		);
		expect(rig.adapter.start).not.toHaveBeenCalled();
	});

	it("rejects with the real error when the adapter cannot start", async () => {
		const rig = fakeRig();
		(rig.adapter.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("spawn claude ENOENT")
		);
		await expect(rig.supplier(request())).rejects.toThrow(
			"spawn claude ENOENT"
		);
	});
});
