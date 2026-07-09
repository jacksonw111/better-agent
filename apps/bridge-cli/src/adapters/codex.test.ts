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

describe("codexAdapter", () => {
	it("pushes an agent_exited status, then closes `events`, once the process exits on its own", async () => {
		const { rpc, triggerExit } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
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

	it("interrupt() cancels the active turn via turn/interrupt (not a process kill)", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		handle.interrupt?.();

		expect(rpc.request).toHaveBeenCalledWith("turn/interrupt", {
			threadId: "thread_1",
		});
		expect(rpc.stop).not.toHaveBeenCalled();
	});
});

// codexAdapter's approval-request specs (surfacing a request, replying,
// unknown-id/repeated/post-exit answers, and RC-T3's interrupt-retracts-
// approvals) live in codex-approvals.test.ts — split out purely to keep this
// file under the repo's 300-line limit.

describe("codexAdapter - startup config (R2-b)", () => {
	it("passes the persisted model on thread/start", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		await codexAdapter.start("/tmp/project", {
			config: { model: "gpt-5-codex" },
		});

		expect(rpc.request).toHaveBeenCalledWith("thread/start", {
			cwd: "/tmp/project",
			model: "gpt-5-codex",
		});
	});

	it("omits model from thread/start when no startup config is given", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		await codexAdapter.start("/tmp/project");

		expect(rpc.request).toHaveBeenCalledWith("thread/start", {
			cwd: "/tmp/project",
		});
	});
});

describe("codexAdapter - getStatus", () => {
	it("caches thread/tokenUsage/updated + thread/status/changed notifications and answers getStatus with exactly one status_snapshot", async () => {
		const { rpc, triggerNotification } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerNotification("thread/tokenUsage/updated", {
			tokenUsage: {
				totalTokenUsage: {
					inputTokens: 100,
					outputTokens: 20,
					cachedInputTokens: 5,
					totalTokens: 120,
				},
				modelContextWindow: 1000,
			},
		});
		triggerNotification("thread/status/changed", { status: "active" });

		handle.getStatus?.();

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "status_snapshot",
			detail: {
				model: undefined,
				running: true,
				tokens: { input: 100, output: 20, cacheRead: 5 },
				contextUsage: { used: 120, size: 1000, pct: 12 },
			},
			turnEpoch: 0,
		});
	});
});

describe("codexAdapter - getStatus - empty snapshot", () => {
	it("answers getStatus with an empty-fields snapshot when no notifications have arrived yet", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		expect(() => handle.getStatus?.()).not.toThrow();

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "status_snapshot",
			detail: {
				model: undefined,
				running: undefined,
				tokens: undefined,
				contextUsage: undefined,
			},
			turnEpoch: 0,
		});
	});
});
