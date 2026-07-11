// R2-T2 integration coverage: session_ready (model/list + static fallback +
// capabilities), per-turn setModel, setPermissionMode, and the usage stream —
// exercised through the real codexAdapter.start()/send() over a fake RPC, not
// just the extracted codex-models.ts/codex-controls.ts unit tests. Split out
// of codex.test.ts purely to keep that file under the repo's 300-line limit;
// duplicates `createFakeRpc` for the same reason (`vi.mock` hoisting is
// per-spec-file).

import { describe, expect, it, vi } from "vitest";
import { codexAdapter } from "./codex";
import { CODEX_STATIC_MODELS } from "./codex-models";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";
import { CODEX_SESSION_CAPABILITIES } from "./session-capabilities";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

type NotificationHandler = (method: string, params: unknown) => void;

/** A fake `JsonRpcIo` whose `request` behavior for `thread/start`/`model/list`
 * a test can override, standing in for the real `codex app-server` process
 * codex.ts spawns. */
function createFakeRpc(modelListResult: () => Promise<unknown>): {
	rpc: JsonRpcIo;
	triggerNotification(method: string, params: unknown): void;
} {
	const notificationHandlers: NotificationHandler[] = [];
	return {
		rpc: {
			notify: vi.fn(),
			onExit: vi.fn(),
			onNotification: (handler) => notificationHandlers.push(handler),
			onRequest: vi.fn(),
			respond: vi.fn(),
			request: vi.fn((method: string) => {
				if (method === "thread/start") {
					return Promise.resolve({ thread: { id: "thread_1" } });
				}
				if (method === "model/list") {
					return modelListResult();
				}
				return Promise.resolve({});
			}),
			stop: vi.fn(),
		},
		triggerNotification(method: string, params: unknown): void {
			for (const handler of notificationHandlers) {
				handler(method, params);
			}
		},
	};
}

describe("codexAdapter - session_ready (R2-T2)", () => {
	it("requests model/list after thread/start and carries its ids + the codex capabilities handshake", async () => {
		const { rpc } = createFakeRpc(() =>
			Promise.resolve({ models: [{ id: "gpt-6" }, { model: "gpt-6-mini" }] })
		);
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		const { value: event } = await handle.events[Symbol.asyncIterator]().next();

		expect(rpc.request).toHaveBeenCalledWith("model/list", {});
		expect(event).toEqual({
			kind: "status",
			status: "session_ready",
			detail: {
				sessionId: "thread_1",
				model: undefined,
				models: ["gpt-6", "gpt-6-mini"],
				capabilities: CODEX_SESSION_CAPABILITIES,
			},
			turnEpoch: 0,
		});
	});

	it("falls back to the static model list when model/list rejects", async () => {
		const { rpc } = createFakeRpc(() => Promise.reject(new Error("boom")));
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		const { value: event } = await handle.events[Symbol.asyncIterator]().next();

		expect(event).toMatchObject({
			detail: { models: [...CODEX_STATIC_MODELS] },
		});
	});

	it("seeds session_ready.model from the persisted startup config", async () => {
		const { rpc } = createFakeRpc(() => Promise.resolve({}));
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project", {
			config: { model: "gpt-5-codex" },
		});
		const { value: event } = await handle.events[Symbol.asyncIterator]().next();

		expect(event).toMatchObject({ detail: { model: "gpt-5-codex" } });
	});
});

describe("codexAdapter - setModel/setPermissionMode (R2-T2)", () => {
	it("applies a setModel call to every subsequent turn/start", async () => {
		const { rpc } = createFakeRpc(() => Promise.resolve({}));
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		await handle.events[Symbol.asyncIterator]().next(); // session_ready

		handle.setModel?.("gpt-5.4");
		handle.send("hello");

		expect(rpc.request).toHaveBeenCalledWith("turn/start", {
			threadId: "thread_1",
			input: [{ type: "text", text: "hello" }],
			approval_policy: "untrusted",
			sandbox_policy: { type: "workspace-write", network_access: false },
			model: "gpt-5.4",
		});
	});

	it("applies a setPermissionMode('never') call to turn/start's approval_policy", async () => {
		const { rpc } = createFakeRpc(() => Promise.resolve({}));
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		await handle.events[Symbol.asyncIterator]().next(); // session_ready

		handle.setPermissionMode?.("never");
		handle.send("hello");

		expect(rpc.request).toHaveBeenCalledWith("turn/start", {
			threadId: "thread_1",
			input: [{ type: "text", text: "hello" }],
			approval_policy: "never",
			sandbox_policy: { type: "workspace-write", network_access: false },
		});
	});

	it("ignores an invalid setPermissionMode value, leaving the previous policy on turn/start", async () => {
		const { rpc } = createFakeRpc(() => Promise.resolve({}));
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		await handle.events[Symbol.asyncIterator]().next(); // session_ready

		handle.setPermissionMode?.("bypassPermissions");
		handle.send("hello");

		expect(rpc.request).toHaveBeenCalledWith("turn/start", {
			threadId: "thread_1",
			input: [{ type: "text", text: "hello" }],
			approval_policy: "untrusted",
			sandbox_policy: { type: "workspace-write", network_access: false },
		});
	});
});

describe("codexAdapter - usage stream (R2-T2)", () => {
	it("maps thread/tokenUsage/updated onto a usage_update status event", async () => {
		const { rpc, triggerNotification } = createFakeRpc(() =>
			Promise.resolve({})
		);
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

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

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "usage_update",
			detail: { used: 120, size: 1000 },
			turnEpoch: 0,
		});
	});
});
