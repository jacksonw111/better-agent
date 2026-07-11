// codexAdapter's approval-request specs — split out of codex.test.ts purely
// to keep that file under the repo's 300-line limit. Duplicates
// `createFakeRpc` for the same reason pi's split files duplicate
// `createFakeProcessIo`: `vi.mock` hoisting is per-spec-file.

import { describe, expect, it, vi } from "vitest";
import { codexAdapter } from "./codex";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";
import type { ProcessExitInfo } from "./process-io";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

type RequestHandler = (id: number, method: string, params: unknown) => void;
type NotificationHandler = (method: string, params: unknown) => void;

/** A fake `JsonRpcIo` whose exit (and server-initiated requests/notifications)
 * can be triggered on demand by the test, standing in for the real `codex
 * app-server` process codex.ts spawns. */
function createFakeRpc(): {
	rpc: JsonRpcIo;
	triggerExit(info: ProcessExitInfo): void;
	triggerNotification(method: string, params: unknown): void;
	triggerRequest(id: number, method: string, params: unknown): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	const requestHandlers: RequestHandler[] = [];
	const notificationHandlers: NotificationHandler[] = [];
	return {
		rpc: {
			notify: vi.fn(),
			onExit: (handler) => exitHandlers.push(handler),
			onNotification: (handler) => notificationHandlers.push(handler),
			onRequest: (handler) => requestHandlers.push(handler),
			respond: vi.fn(),
			request: vi.fn((method: string) => {
				if (method === "thread/start") {
					return Promise.resolve({ thread: { id: "thread_1" } });
				}
				return Promise.resolve({});
			}),
			stop: vi.fn(),
		},
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
		triggerNotification(method: string, params: unknown): void {
			for (const handler of notificationHandlers) {
				handler(method, params);
			}
		},
		triggerRequest(id: number, method: string, params: unknown): void {
			for (const handler of requestHandlers) {
				handler(id, method, params);
			}
		},
	};
}

// An arbitrary RPC request id, distinct from 0/1 so it's obviously not being
// confused with an array index or a boolean-ish flag.
const APPROVAL_REQUEST_ID = 7;

describe("codexAdapter - interrupt retracts approvals (RC-T3)", () => {
	it("retracts a pending approval and emits a cancelled event; a late answer is a no-op", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // R2-T2: session_ready

		triggerRequest(
			APPROVAL_REQUEST_ID,
			"item/commandExecution/requestApproval",
			{ itemId: "item_1", command: ["rm", "-rf", "node_modules"] }
		);
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

		handle.answerApproval(String(APPROVAL_REQUEST_ID), "accept");
		expect(rpc.respond).not.toHaveBeenCalled();
	});
});

describe("codexAdapter - approvals", () => {
	it("surfaces a commandExecution approval request and replies via answerApproval", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // R2-T2: session_ready

		triggerRequest(
			APPROVAL_REQUEST_ID,
			"item/commandExecution/requestApproval",
			{
				itemId: "item_1",
				command: ["rm", "-rf", "node_modules"],
			}
		);

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			detail: "rm -rf node_modules",
			kind: "approval",
			options: [
				{ id: "accept", label: "Allow" },
				{ id: "acceptForSession", label: "Allow for session" },
				{ id: "decline", label: "Deny" },
			],
			requestId: String(APPROVAL_REQUEST_ID),
			timeoutAt: expect.any(Number),
			timeoutMs: expect.any(Number),
			title: "Run command?",
			turnEpoch: 0,
		});

		handle.answerApproval(String(APPROVAL_REQUEST_ID), "accept");
		expect(rpc.respond).toHaveBeenCalledExactlyOnceWith(APPROVAL_REQUEST_ID, {
			decision: "accept",
		});
	});
});

describe("codexAdapter - approvals - unknown requestId", () => {
	it("emits a status warning instead of replying for an unknown requestId", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // R2-T2: session_ready

		handle.answerApproval("does-not-exist", "accept");

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			detail: { requestId: "does-not-exist" },
			kind: "status",
			status: "approval_unknown",
			turnEpoch: 0,
		});
		expect(rpc.respond).not.toHaveBeenCalled();
	});
});

// R3-T2: end-to-end through the adapter — item/started's changes[] are
// cached (normalize/codex-file-change-cache.ts) and read back out once the
// matching item/fileChange/requestApproval arrives, and the literal
// "acceptForSession" id round-trips unchanged through answerApproval. Split
// into its own describe (rather than folded into "codexAdapter - approvals"
// above) to keep that describe's callback under this file's max-lines gate.
describe("codexAdapter - approvals - fileChange summary (R3-T2)", () => {
	it("attaches a fileChange summary cached from item/started, and replies acceptForSession unchanged", async () => {
		const { rpc, triggerNotification, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // R2-T2: session_ready

		triggerNotification("item/started", {
			item: {
				id: "item_1",
				type: "fileChange",
				changes: [
					{ path: "a.ts", kind: "created" },
					{ path: "b.ts", kind: "modified" },
				],
			},
		});
		triggerRequest(APPROVAL_REQUEST_ID, "item/fileChange/requestApproval", {
			itemId: "item_1",
		});

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "approval",
			options: [
				{ id: "accept", label: "Allow" },
				{ id: "acceptForSession", label: "Allow for session" },
				{ id: "decline", label: "Deny" },
			],
			requestId: String(APPROVAL_REQUEST_ID),
			summary: "2 files: 1 added, 1 modified (a.ts, b.ts)",
			timeoutAt: expect.any(Number),
			timeoutMs: expect.any(Number),
			title: "Apply file change?",
			turnEpoch: 0,
		});

		handle.answerApproval(String(APPROVAL_REQUEST_ID), "acceptForSession");
		expect(rpc.respond).toHaveBeenCalledExactlyOnceWith(APPROVAL_REQUEST_ID, {
			decision: "acceptForSession",
		});
	});
});

describe("codexAdapter - approvals - repeated or post-exit answers", () => {
	it("writes exactly one reply frame when answerApproval is called twice for the same requestId", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // R2-T2: session_ready

		triggerRequest(
			APPROVAL_REQUEST_ID,
			"item/commandExecution/requestApproval",
			{ itemId: "item_1", command: ["ls"] }
		);
		await iterator.next();

		handle.answerApproval(String(APPROVAL_REQUEST_ID), "accept");
		handle.answerApproval(String(APPROVAL_REQUEST_ID), "accept");

		expect(rpc.respond).toHaveBeenCalledExactlyOnceWith(APPROVAL_REQUEST_ID, {
			decision: "accept",
		});
		const { value: event } = await iterator.next();
		expect(event).toEqual({
			detail: { requestId: String(APPROVAL_REQUEST_ID) },
			kind: "status",
			status: "approval_unknown",
			turnEpoch: 0,
		});
	});

	it("does not throw and writes no reply for answerApproval called after the process exits", async () => {
		const { rpc, triggerRequest, triggerExit } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);
		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // R2-T2: session_ready

		triggerRequest(
			APPROVAL_REQUEST_ID,
			"item/commandExecution/requestApproval",
			{ itemId: "item_1", command: ["ls"] }
		);
		await iterator.next();

		triggerExit({ code: 0, signal: null });

		expect(() =>
			handle.answerApproval(String(APPROVAL_REQUEST_ID), "accept")
		).not.toThrow();
		expect(rpc.respond).not.toHaveBeenCalled();
	});
});
