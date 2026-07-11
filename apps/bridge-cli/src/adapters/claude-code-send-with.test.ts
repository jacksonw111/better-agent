// R3-T1: claude-code's `sendWith` — "interrupt" calls `session.interrupt()`
// then sends the text as a fresh turn (claude-code has no "steer"; it isn't
// in CLAUDE_CODE_SESSION_CAPABILITIES.busyModes, so `dispatchTextCommand`
// never routes one here). Split out of claude-code.test.ts purely to keep
// that file under the repo's 300-line limit, the same way
// claude-code-interrupt.test.ts already splits off `interrupt()`'s own specs.

import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery } from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("sendWith('interrupt') calls session.interrupt() before sending the fresh turn", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.sendWith?.("fresh start", "interrupt");

	expect(harness.interrupt).toHaveBeenCalledTimes(1);
	const { value } = await harness.prompt[Symbol.asyncIterator]().next();
	expect(value).toEqual({
		type: "user",
		message: { role: "user", content: "fresh start" },
		parent_tool_use_id: null,
	});
});

it("sendWith('queue') behaves like a plain send — no interrupt call", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.sendWith?.("queued", "queue");

	expect(harness.interrupt).not.toHaveBeenCalled();
	const { value } = await harness.prompt[Symbol.asyncIterator]().next();
	expect(value).toMatchObject({ message: { content: "queued" } });
});
