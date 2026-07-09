import { describe, expect, it, vi } from "vitest";
import { connectJsonRpc } from "./jsonrpc-io";
import { opencodeAdapter } from "./opencode";
import { createFakeRpc } from "./opencode-test-harness";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

describe("opencodeAdapter", () => {
	it("pushes an agent_exited status, then closes `events`, once the process exits on its own", async () => {
		const { rpc, triggerExit } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerExit({ code: 1, signal: null });

		const { value: statusEvent } = await iterator.next();
		expect(statusEvent).toEqual({
			kind: "status",
			status: "agent_exited",
			turnEpoch: 0,
		});

		const result = await iterator.next();
		expect(result.done).toBe(true);
	});
});

describe("opencodeAdapter - session_ready", () => {
	it("emits a session_ready event enriched with cwd/sessionId when available_commands_update arrives", async () => {
		const { rpc, triggerNotification } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerNotification("session/update", {
			sessionId: "session_1",
			update: {
				sessionUpdate: "available_commands_update",
				availableCommands: [
					{ name: "explain", description: "Explain the codebase" },
				],
			},
		});

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "session_ready",
			detail: {
				slashCommands: ["explain"],
				cwd: "/tmp/project",
				sessionId: "session_1",
			},
			turnEpoch: 0,
		});
	});
});

describe("opencodeAdapter - session_ready emitted only once", () => {
	it("never emits a second session_ready if available_commands_update arrives twice", async () => {
		const { rpc, triggerNotification } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		const notify = () =>
			triggerNotification("session/update", {
				sessionId: "session_1",
				update: {
					sessionUpdate: "available_commands_update",
					availableCommands: [{ name: "explain" }],
				},
			});
		notify();
		await iterator.next();

		notify();
		triggerNotification("session/update", {
			update: { sessionUpdate: "plan", entries: [{ content: "step 1" }] },
		});

		const { value: nextEvent } = await iterator.next();
		expect(nextEvent).toEqual({
			kind: "status",
			status: "plan",
			detail: [{ content: "step 1" }],
			turnEpoch: 0,
		});
	});
});

// An arbitrary RPC request id, distinct from 0/1 so it's obviously not being
// confused with an array index or a boolean-ish flag.
const APPROVAL_REQUEST_ID = 3;

describe("opencodeAdapter - approvals", () => {
	it("surfaces a session/request_permission request and replies via answerApproval", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerRequest(APPROVAL_REQUEST_ID, "session/request_permission", {
			sessionId: "session_1",
			toolCall: { title: "Run `ls`", rawInput: { command: "ls" } },
			options: [
				{ optionId: "allow-once", name: "Allow", kind: "allow_once" },
				{ optionId: "reject-once", name: "Deny", kind: "reject_once" },
			],
		});

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			detail: JSON.stringify({ command: "ls" }),
			kind: "approval",
			options: [
				{ id: "allow-once", label: "Allow" },
				{ id: "reject-once", label: "Deny" },
			],
			requestId: String(APPROVAL_REQUEST_ID),
			title: "Run `ls`",
			turnEpoch: 0,
		});

		handle.answerApproval(String(APPROVAL_REQUEST_ID), "allow-once");
		expect(rpc.respond).toHaveBeenCalledExactlyOnceWith(APPROVAL_REQUEST_ID, {
			outcome: { optionId: "allow-once", outcome: "selected" },
		});
	});

	it("emits a status warning instead of replying for an unknown requestId", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await opencodeAdapter.start("/tmp/project");

		handle.answerApproval("does-not-exist", "allow-once");

		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			detail: { requestId: "does-not-exist" },
			kind: "status",
			status: "approval_unknown",
			turnEpoch: 0,
		});
		expect(rpc.respond).not.toHaveBeenCalled();
	});
});

describe("opencodeAdapter - getStatus", () => {
	it("caches a streamed usage_update and answers getStatus with one status_snapshot", async () => {
		const { rpc, triggerNotification } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerNotification("session/update", {
			sessionId: "session_1",
			update: {
				sessionUpdate: "usage_update",
				used: 48_000,
				size: 200_000,
				cost: { amount: 0.045, currency: "USD" },
			},
		});
		await iterator.next(); // the pass-through usage_update status event

		handle.getStatus?.();

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "status_snapshot",
			detail: {
				model: undefined,
				costUsd: 0.045,
				contextUsage: { used: 48_000, size: 200_000, pct: 24 },
			},
			turnEpoch: 0,
		});
	});

	it("answers getStatus with an empty-fields snapshot when no usage_update has arrived yet", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		expect(() => handle.getStatus?.()).not.toThrow();

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "status_snapshot",
			detail: { model: undefined, costUsd: undefined, contextUsage: undefined },
			turnEpoch: 0,
		});
	});
});

describe("opencodeAdapter - model & permission controls", () => {
	it("dispatches setModel to the ACP unstable_setSessionModel method", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await opencodeAdapter.start("/tmp/project");

		handle.setModel?.("anthropic/claude-sonnet-4");

		expect(rpc.request).toHaveBeenCalledWith("unstable_setSessionModel", {
			sessionId: "session_1",
			model: "anthropic/claude-sonnet-4",
		});
	});

	it("dispatches setPermissionMode to the ACP session/set_mode method", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await opencodeAdapter.start("/tmp/project");

		handle.setPermissionMode?.("plan");

		expect(rpc.request).toHaveBeenCalledWith("session/set_mode", {
			sessionId: "session_1",
			mode: "plan",
		});
	});
});

describe("opencodeAdapter - interrupt", () => {
	// T0: the web Stop button relays `interrupt()` — before this, opencode's
	// AgentHandle had no `interrupt` at all despite agent-capabilities.ts
	// advertising `interrupt: true`, so Stop silently did nothing.
	it("notifies session/cancel with the session id on interrupt", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await opencodeAdapter.start("/tmp/project");

		handle.interrupt?.();

		expect(rpc.notify).toHaveBeenCalledWith("session/cancel", {
			sessionId: "session_1",
		});
	});

	it("retracts a pending approval and emits a cancelled event; a late answer is a no-op (RC-T3)", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerRequest(APPROVAL_REQUEST_ID, "session/request_permission", {
			sessionId: "session_1",
			toolCall: { title: "Run `rm`", rawInput: { command: "rm -rf" } },
			options: [{ optionId: "allow-once", name: "Allow", kind: "allow_once" }],
		});
		await iterator.next(); // the approval event

		handle.interrupt?.();
		const { value: retract } = await iterator.next();
		expect(retract).toEqual({
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: String(APPROVAL_REQUEST_ID),
			title: "Cancelled",
			turnEpoch: 1,
		});

		handle.answerApproval(String(APPROVAL_REQUEST_ID), "allow-once");
		expect(rpc.respond).not.toHaveBeenCalled();
	});
});
