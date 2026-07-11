// R3-1 review finding 2 (ASSUMPTION, unverified — no `codex` binary in this
// sandbox): codex's sendWith("interrupt") previously fired turn/interrupt and
// turn/start back-to-back without waiting for the interrupt's own response —
// sending immediately can race codex mid-abort and reject/drop the new turn.
// Split out of codex.test.ts purely to keep that file under the repo's
// 300-line limit. Duplicates `createFakeRpc` for the same reason
// codex-approvals.test.ts does: `vi.mock` hoisting is per-spec-file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codexAdapter } from "./codex";
import type { JsonRpcIo } from "./jsonrpc-io";
import { connectJsonRpc } from "./jsonrpc-io";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

/** A fake `JsonRpcIo` whose `turn/interrupt` response is held open until the
 * test explicitly resolves it (via the returned `resolveInterrupt`) — lets
 * the test observe whatever `turn/start` does (or doesn't) send while the
 * interrupt is still in flight. */
function createFakeRpc(): {
	resolveInterrupt(): void;
	rpc: JsonRpcIo;
} {
	let resolveInterrupt: (() => void) | undefined;
	const rpc: JsonRpcIo = {
		notify: vi.fn(),
		onExit: () => undefined,
		onNotification: () => undefined,
		onRequest: () => undefined,
		respond: vi.fn(),
		request: vi.fn((method: string) => {
			if (method === "thread/start") {
				return Promise.resolve({ thread: { id: "thread_1" } });
			}
			if (method === "turn/interrupt") {
				return new Promise<void>((resolve) => {
					resolveInterrupt = resolve;
				});
			}
			return Promise.resolve({});
		}),
		stop: vi.fn(),
	};
	return {
		resolveInterrupt() {
			resolveInterrupt?.();
		},
		rpc,
	};
}

describe("codexAdapter - sendWith('interrupt') ordering (R3-1 finding 2, ASSUMPTION)", () => {
	it("sends turn/start only after turn/interrupt's own request settles", async () => {
		const { resolveInterrupt, rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		handle.sendWith?.("fresh start", "interrupt");

		expect(rpc.request).toHaveBeenCalledWith("turn/interrupt", {
			threadId: "thread_1",
		});
		expect(rpc.request).not.toHaveBeenCalledWith(
			"turn/start",
			expect.anything()
		);

		resolveInterrupt();
		await vi.waitFor(() => {
			expect(rpc.request).toHaveBeenCalledWith(
				"turn/start",
				expect.objectContaining({
					threadId: "thread_1",
					input: [{ type: "text", text: "fresh start" }],
				})
			);
		});
	});
});

// Comfortably longer than interrupt-then-send.ts's own 500ms settle timeout,
// so advancing by this much always fires it.
const PAST_SETTLE_TIMEOUT_MS = 1000;

describe("codexAdapter - sendWith('interrupt') never hangs forever if turn/interrupt never resolves (R3-1 finding 2)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("sends turn/start after the short settle timeout even if turn/interrupt's promise never settles", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await codexAdapter.start("/tmp/project");
		handle.sendWith?.("fresh start", "interrupt");

		expect(rpc.request).not.toHaveBeenCalledWith(
			"turn/start",
			expect.anything()
		);

		// Never call resolveInterrupt() — the ~500ms race-with-timeout is the
		// only thing that can still unblock the send.
		await vi.advanceTimersByTimeAsync(PAST_SETTLE_TIMEOUT_MS);

		expect(rpc.request).toHaveBeenCalledWith(
			"turn/start",
			expect.objectContaining({
				threadId: "thread_1",
				input: [{ type: "text", text: "fresh start" }],
			})
		);
	});
});
