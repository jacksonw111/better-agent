// RC-T4's empty-options no-hang fix for opencode's ACP approvals — split out
// of opencode.test.ts purely to keep that file under the repo's 300-line file
// cap. See opencode.test.ts's "opencodeAdapter - approvals" describe block
// for the base (non-empty-options) approval coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_DENY_OPTION_ID } from "../normalize/opencode";
import { APPROVAL_TIMEOUT_MS } from "./approvals";
import { connectJsonRpc } from "./jsonrpc-io";
import { opencodeAdapter } from "./opencode";
import { createFakeRpc } from "./opencode-test-harness";

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

// An arbitrary RPC request id, distinct from 0/1 so it's obviously not being
// confused with an array index or a boolean-ish flag.
const APPROVAL_REQUEST_ID = 3;

describe("opencodeAdapter - approvals - empty options never hangs (RC-T4)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("presents a fallback deny-only card, and picking it replies with a cancelled outcome (never selected)", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerRequest(APPROVAL_REQUEST_ID, "session/request_permission", {
			sessionId: "session_1",
			toolCall: { title: "Run something unrepresentable" },
			options: [],
		});

		const { value: event } = await iterator.next();
		expect(event).toMatchObject({
			kind: "approval",
			options: [{ id: FALLBACK_DENY_OPTION_ID }],
		});

		handle.answerApproval(String(APPROVAL_REQUEST_ID), FALLBACK_DENY_OPTION_ID);
		expect(rpc.respond).toHaveBeenCalledExactlyOnceWith(APPROVAL_REQUEST_ID, {
			outcome: { outcome: "cancelled" },
		});
	});

	it("never hangs forever: an unanswered empty-options request resolves via the shared timeout", async () => {
		const { rpc, triggerRequest } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		const handle = await opencodeAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerRequest(APPROVAL_REQUEST_ID, "session/request_permission", {
			sessionId: "session_1",
			toolCall: { title: "Run something unrepresentable" },
			options: [],
		});
		await iterator.next(); // the card

		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);

		expect(rpc.respond).toHaveBeenCalledExactlyOnceWith(APPROVAL_REQUEST_ID, {
			outcome: { outcome: "cancelled" },
		});
		const { value: timeoutEvent } = await iterator.next();
		expect(timeoutEvent).toMatchObject({
			kind: "approval",
			cancelled: true,
			title: "Timed out — declined",
		});
	});
});
