// RC-T5: opencode.ts (the ACP transport) had no "the turn is over" status
// signal at all — session/prompt's resolution was only ever used to surface a
// failure. Without one, the activity watchdog (session-watchdog.ts) would
// never see an ACP session's turn complete, and could eventually false-stall
// a perfectly idle session. Split into its own file, alongside
// opencode-approvals.test.ts, purely to keep opencode.test.ts under the
// repo's 300-line file cap.

import { describe, expect, it, vi } from "vitest";
import { connectJsonRpc, type JsonRpcIo } from "./jsonrpc-io";
import { opencodeAdapter } from "./opencode";
import { createFakeRpc } from "./opencode-test-harness";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

// Split across several `describe` blocks purely to keep each under the
// repo's max-lines-per-function gate (ESLint counts a `describe` callback's
// own body, including every nested `it`, toward that limit).

describe("opencodeAdapter - turn_end status (RC-T5)", () => {
	it("pushes a turn_end status once session/prompt resolves", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		handle.send("do it");
		await iterator.next(); // the echoed user message

		const { value: turnEnd } = await iterator.next();
		expect(turnEnd).toEqual({
			kind: "status",
			status: "turn_end",
			turnEpoch: 1,
		});
	});
});

describe("opencodeAdapter - stale turn_end guard (RC-T5 x RC-T3)", () => {
	it("does not push turn_end for a turn superseded by an interrupt before session/prompt resolves", async () => {
		let resolvePrompt: (() => void) | undefined;
		const rpc: JsonRpcIo = {
			notify: vi.fn(),
			onExit: vi.fn(),
			onNotification: vi.fn(),
			onRequest: vi.fn(),
			respond: vi.fn(),
			request: vi.fn((method: string) => {
				if (method === "session/new") {
					return Promise.resolve({ sessionId: "session_1" });
				}
				if (method === "session/prompt") {
					return new Promise<unknown>((resolve) => {
						resolvePrompt = () => resolve({});
					});
				}
				return Promise.resolve({});
			}),
			stop: vi.fn(),
		};
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		handle.send("do it");
		await iterator.next(); // the echoed user message

		// Bumps the epoch before session/prompt ever resolves. There's no
		// pending approval to retract, so this pushes nothing on its own.
		handle.interrupt?.();

		resolvePrompt?.();
		// Give the resolved promise's `.then()` a microtask turn to run.
		await Promise.resolve();
		await Promise.resolve();

		handle.send("another turn");
		const { value: secondEcho } = await iterator.next();
		expect(secondEcho).toEqual({
			kind: "message",
			role: "user",
			text: "another turn",
			turnEpoch: 3,
		});
		// The stale session/prompt's turn_end (epoch 1) must never have been
		// pushed ahead of this second turn's own echo.
	});
});
