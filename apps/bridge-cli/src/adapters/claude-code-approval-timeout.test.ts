import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { APPROVAL_TIMEOUT_MS } from "./approvals";
import { claudeCodeAdapter } from "./claude-code";
import {
	mockQuery,
	nextEvent,
	skipStartupReady,
} from "./claude-code-test-harness";

// FIX2 (rc-final-review): makeCanUseTool used to call `approvals.register`
// directly instead of routing through the shared RC-T4 fail-closed contract
// (`presentApproval`) every other adapter's approvals already use — so an
// unanswered claude approval hung `canUseTool`'s promise forever instead of
// resolving a visible deny after `APPROVAL_TIMEOUT_MS`. Split out of
// claude-code.test.ts purely to keep both files under the repo's 300-line cap
// (fake timers need their own beforeEach/afterEach, which claude-code.test.ts
// doesn't otherwise need).

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

// Named alias for canUseTool's third parameter's type, purely so the three
// `as` casts below reference a name instead of a literal tuple index (which
// eslint's no-magic-numbers otherwise flags as a "magic number", despite this
// being a type position with no runtime value).
// eslint-disable-next-line no-magic-numbers -- a tuple-index type position, not a runtime value
type CanUseToolOptions = Parameters<CanUseTool>[2];

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

it("denies (fail-closed) and pushes a visible timed-out event once an approval goes unanswered past the timeout", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	await skipStartupReady(iterator);

	const options = { toolUseID: "req_timeout" } as CanUseToolOptions;
	const decision = harness.canUseTool("Bash", { command: "rm -rf" }, options);
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "approval",
		requestId: "req_timeout",
		title: "Use Bash?",
	});

	await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);

	const result = await decision;
	expect(result).toEqual({
		behavior: "deny",
		message: "Timed out waiting for approval — denied.",
	});
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "approval",
		cancelled: true,
		requestId: "req_timeout",
		title: "Timed out — declined",
	});

	// A late answer after the timeout already resolved this id must not
	// double-resolve canUseTool's promise (it already settled above).
	handle.answerApproval("req_timeout", "allow");
});

it("still allows on a timely answer, even with fake timers armed", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	await skipStartupReady(iterator);

	const options = { toolUseID: "req_ontime" } as CanUseToolOptions;
	const decision = harness.canUseTool("Bash", { command: "ls" }, options);
	await nextEvent(iterator);

	handle.answerApproval("req_ontime", "allow");
	const result = await decision;
	expect(result).toEqual({
		behavior: "allow",
		updatedInput: { command: "ls" },
	});

	// The timeout never fires for an already-answered approval.
	await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);
	expect(
		await Promise.race([nextEvent(iterator), Promise.resolve("idle")])
	).toBe("idle");
});

it("still denies on a timely rejection, even with fake timers armed", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	await skipStartupReady(iterator);

	const options = { toolUseID: "req_ontime_deny" } as CanUseToolOptions;
	const decision = harness.canUseTool("Bash", { command: "rm -rf" }, options);
	await nextEvent(iterator);

	handle.answerApproval("req_ontime_deny", "deny");
	const result = await decision;
	expect(result).toEqual({
		behavior: "deny",
		message: "Denied from the bridge.",
	});
});
