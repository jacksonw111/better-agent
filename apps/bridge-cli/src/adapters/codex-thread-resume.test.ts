// codexAdapter's thread/resume specs — split out of codex.test.ts purely to
// keep that file under the repo's 300-line limit. Duplicates `createFakeRpc`
// for the same reason codex-approvals.test.ts does: `vi.mock` hoisting is
// per-spec-file.
//
// R5-T1: the restart chain's context-preserving path — `opts.resume` (the
// prior thread id, captured off that session's own `session_ready`, see
// capture-agent-session-id.ts) makes `start()` try `thread/resume` first,
// falling back to a fresh `thread/start` (plus a visible `resume_failed`
// status) on any failure. See codex-resume.ts's doc comments.

import { describe, expect, it, vi } from "vitest";
import { codexAdapter } from "./codex";
import { CODEX_THREAD_RESUME_TIMEOUT_MS } from "./codex-resume";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";
import type { ProcessExitInfo } from "./process-io";
import type { QuotaSnapshot } from "./types";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

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

describe("codexAdapter - thread/resume success (R5-T1)", () => {
	it("tries thread/resume first when opts.resume is set, and uses its thread id for turn/start", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(rpc.request).mockImplementation((method: string) => {
			if (method === "thread/resume") {
				return Promise.resolve({ thread: { id: "resumed_thread" } });
			}
			return Promise.resolve({});
		});
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project", {
			resume: "prior_thread",
		});
		handle.send("hello");

		expect(rpc.request).toHaveBeenCalledWith("thread/resume", {
			threadId: "prior_thread",
		});
		expect(rpc.request).not.toHaveBeenCalledWith(
			"thread/start",
			expect.anything()
		);
		expect(rpc.request).toHaveBeenCalledWith(
			"turn/start",
			expect.objectContaining({ threadId: "resumed_thread" })
		);
	});
});

describe("codexAdapter - thread/resume fallback (R5-T1)", () => {
	it("falls back to thread/start and pushes resume_failed when thread/resume errors", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(rpc.request).mockImplementation((method: string) => {
			if (method === "thread/resume") {
				return Promise.reject(new Error("no such thread"));
			}
			if (method === "thread/start") {
				return Promise.resolve({ thread: { id: "fresh_thread" } });
			}
			return Promise.resolve({});
		});
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project", {
			resume: "prior_thread",
		});
		const iterator = handle.events[Symbol.asyncIterator]();

		const { value: resumeFailed } = await iterator.next();
		expect(resumeFailed).toEqual({
			kind: "status",
			status: "resume_failed",
			detail: { reason: "no such thread" },
			turnEpoch: 0,
		});

		await iterator.next(); // session_ready, off the fresh thread

		expect(rpc.request).toHaveBeenCalledWith(
			"thread/start",
			expect.objectContaining({ cwd: "/tmp/project" })
		);

		handle.send("hello");
		expect(rpc.request).toHaveBeenCalledWith(
			"turn/start",
			expect.objectContaining({ threadId: "fresh_thread" })
		);
	});
});

describe("codexAdapter - thread/resume timeout/absent (R5-T1)", () => {
	it("falls back to thread/start on a thread/resume timeout", async () => {
		vi.useFakeTimers();
		try {
			const { rpc } = createFakeRpc();
			vi.mocked(rpc.request).mockImplementation((method: string) => {
				if (method === "thread/resume") {
					return new Promise(() => undefined);
				}
				if (method === "thread/start") {
					return Promise.resolve({ thread: { id: "fresh_thread_2" } });
				}
				return Promise.resolve({});
			});
			vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

			const startPromise = codexAdapter.start("/tmp/project", {
				resume: "prior_thread",
			});
			await vi.advanceTimersByTimeAsync(CODEX_THREAD_RESUME_TIMEOUT_MS);
			const handle = await startPromise;

			handle.send("hello");
			expect(rpc.request).toHaveBeenCalledWith(
				"turn/start",
				expect.objectContaining({ threadId: "fresh_thread_2" })
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("goes straight to thread/start when opts.resume is absent (unchanged pre-R5-T1 behavior)", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		await codexAdapter.start("/tmp/project");

		expect(rpc.request).not.toHaveBeenCalledWith(
			"thread/resume",
			expect.anything()
		);
		expect(rpc.request).toHaveBeenCalledWith(
			"thread/start",
			expect.objectContaining({ cwd: "/tmp/project" })
		);
	});
});
