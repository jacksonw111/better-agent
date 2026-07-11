import { describe, expect, it, vi } from "vitest";
import { codexAdapter } from "./codex";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";
import type { ProcessExitInfo } from "./process-io";
import type { QuotaSnapshot } from "./types";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

// R4-T1: codex.ts's real getStatus wiring now also races the account-quota
// cache (see codex-status.ts's `defaultCodexQuotaCache`) — mocked here so
// this suite (which drives the REAL `codexAdapter`, unlike the quota
// fetcher's own unit tests) never touches the real ~/.codex/auth.json or
// makes a real network call.
const FAKE_QUOTA: QuotaSnapshot = {
	provider: "codex",
	windows: [],
	fetchedAt: "2026-07-11T00:00:00Z",
	unavailableReason: "test double — no real fetch",
};
vi.mock("./quota/codex-quota", () => ({
	fetchCodexQuota: vi.fn(() => Promise.resolve(FAKE_QUOTA)),
}));

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
		await iterator.next(); // R2-T2: session_ready, pushed before start() returns

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

// RC-T6: codex app-server versions have serialized `thread/start`'s thread
// id under different keys — see codex.ts's `threadIdFrom` doc comment.
// Driven through `interrupt()`'s `turn/interrupt` call (the id's only other
// consumer besides `turn/start`, covered by the sandbox/approval-policy spec
// below) rather than exporting `threadIdFrom` directly, so this proves the
// resolved id actually reaches the wire, not just the parsing helper.
describe("codexAdapter - thread/start multi-key thread id (RC-T6)", () => {
	it("resolves the thread id from a top-level sessionId when thread.id is absent", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(rpc.request).mockImplementation((method: string) =>
			method === "thread/start"
				? Promise.resolve({ sessionId: "session_2" })
				: Promise.resolve({})
		);
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		handle.interrupt?.();

		expect(rpc.request).toHaveBeenCalledWith("turn/interrupt", {
			threadId: "session_2",
		});
	});

	it("resolves the thread id from a top-level threadId when neither thread.id nor sessionId is present", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(rpc.request).mockImplementation((method: string) =>
			method === "thread/start"
				? Promise.resolve({ threadId: "thread_3" })
				: Promise.resolve({})
		);
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		handle.interrupt?.();

		expect(rpc.request).toHaveBeenCalledWith("turn/interrupt", {
			threadId: "thread_3",
		});
	});

	it("prefers thread.id over every other key when several are present", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(rpc.request).mockImplementation((method: string) =>
			method === "thread/start"
				? Promise.resolve({
						thread: { id: "thread_1" },
						sessionId: "session_2",
						threadId: "thread_3",
					})
				: Promise.resolve({})
		);
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		handle.interrupt?.();

		expect(rpc.request).toHaveBeenCalledWith("turn/interrupt", {
			threadId: "thread_1",
		});
	});
});

// codexAdapter's approval-request specs (surfacing a request, replying,
// unknown-id/repeated/post-exit answers, and RC-T3's interrupt-retracts-
// approvals) live in codex-approvals.test.ts — split out purely to keep this
// file under the repo's 300-line limit.

describe("codexAdapter - turn/start sandbox/approval policy (RC-T4)", () => {
	it("gates shell/patch execution by sending approval_policy + sandbox_policy on every turn/start", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		handle.send("hello");

		expect(rpc.request).toHaveBeenCalledWith("turn/start", {
			threadId: "thread_1",
			input: [{ type: "text", text: "hello" }],
			approval_policy: "untrusted",
			sandbox_policy: { type: "workspace-write", network_access: false },
		});
	});
});

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
		await iterator.next(); // R2-T2: session_ready

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
		await iterator.next(); // R2-T2: usage_update, pushed alongside the cache update
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
				quota: FAKE_QUOTA,
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
		await iterator.next(); // R2-T2: session_ready

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
				quota: FAKE_QUOTA,
			},
			turnEpoch: 0,
		});
	});
});
