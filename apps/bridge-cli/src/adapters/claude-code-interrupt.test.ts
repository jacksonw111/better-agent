// RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): the audited bug —
// `session.interrupt()` cancelled the SDK turn but never touched the pending-
// approval map, so a stale approval card survived into the NEXT turn and the
// user's late answer resolved a resolver whose context had already changed.
// Split out of claude-code.test.ts purely to keep that file under the repo's
// 300-line limit, the same way claude-code-config.test.ts already splits off
// other claude-code.ts specs.

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import {
	mockQuery,
	nextEvent,
	skipStartupReady,
} from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("interrupt() retracts a pending approval, cancels its resolver, and a late answer is a no-op (RC-T3)", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	await skipStartupReady(iterator);

	const options = { toolUseID: "req_3" } as Parameters<CanUseTool>[2];
	const decision = harness.canUseTool("Bash", { command: "ls" }, options);
	let resolved = false;
	decision.then(() => {
		resolved = true;
	});
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "approval",
		requestId: "req_3",
	});

	handle.interrupt?.();
	expect(await nextEvent(iterator)).toEqual({
		kind: "approval",
		cancelled: true,
		options: [],
		requestId: "req_3",
		title: "Cancelled",
		turnEpoch: 1,
	});

	// A late answer for the retracted request must not resolve the stale
	// canUseTool decision — the registry treats it as an unknown id.
	handle.answerApproval("req_3", "allow");
	expect(await nextEvent(iterator)).toEqual({
		kind: "status",
		status: "approval_unknown",
		detail: { requestId: "req_3" },
		turnEpoch: 1,
	});
	await Promise.resolve();
	await Promise.resolve();
	expect(resolved).toBe(false);
});
