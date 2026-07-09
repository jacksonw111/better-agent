import { type CanUseTool, query } from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery, nextEvent } from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("streams the reply as output once and drops the duplicate final text block", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	// The response text streams live via stream_event text_delta...
	harness.yieldMessage({
		type: "stream_event",
		event: {
			type: "content_block_delta",
			delta: { type: "text_delta", text: "hey" },
		},
	});
	expect(await nextEvent(iterator)).toEqual({
		kind: "output",
		text: "hey",
		turnEpoch: 0,
	});

	// ...and the final assistant message repeats it plus a tool_use: the text
	// block must be dropped (already streamed above) while tool_use survives.
	harness.yieldMessage({
		type: "assistant",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "hey" },
				{ type: "tool_use", id: "toolu_1", name: "Read", input: {} },
			],
		},
	});
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "tool",
		id: "toolu_1",
	});
});

it("normalizes a thinking_delta stream_event into a reasoning-flagged output event", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "stream_event",
		event: {
			type: "content_block_delta",
			delta: { type: "thinking_delta", thinking: "pondering…" },
		},
	});
	expect(await nextEvent(iterator)).toEqual({
		kind: "output",
		text: "pondering…",
		reasoning: true,
		turnEpoch: 0,
	});
});

it("persists the user's turn AND forwards it to the SDK on send", async () => {
	// The event keeps the user's input in history on reload; the prompt drives the agent.
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.send("do the thing");
	expect(await iterator.next()).toEqual({
		done: false,
		value: {
			kind: "message",
			role: "user",
			text: "do the thing",
			turnEpoch: 1,
		},
	});
	const { value } = await harness.prompt[Symbol.asyncIterator]().next();
	expect(value).toEqual({
		type: "user",
		message: { role: "user", content: "do the thing" },
		parent_tool_use_id: null,
	});
});

it("routes a tool permission request to an approval event and resolves allow", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	const options = { toolUseID: "req_1" } as Parameters<CanUseTool>[2];
	const decision = harness.canUseTool("Bash", { command: "ls" }, options);
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "approval",
		requestId: "req_1",
		title: "Use Bash?",
	});

	handle.answerApproval("req_1", "allow");
	const result = await decision;
	expect(result?.behavior).toBe("allow");
});

it("resolves deny when the user rejects the tool", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	const options = { toolUseID: "req_2" } as Parameters<CanUseTool>[2];
	const decision = harness.canUseTool("Bash", { command: "rm -rf" }, options);
	await nextEvent(iterator);

	handle.answerApproval("req_2", "deny");
	const result = await decision;
	expect(result?.behavior).toBe("deny");
});

it("stop() interrupts the session and closes the events stream", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.stop();
	expect(harness.interrupt).toHaveBeenCalledTimes(1);
	expect((await iterator.next()).done).toBe(true);
});

it("interrupt() calls session.interrupt() but leaves the events stream open", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.interrupt?.();
	expect(harness.interrupt).toHaveBeenCalledTimes(1);
	handle.send("still here?");
	const { value } = await harness.prompt[Symbol.asyncIterator]().next();
	expect(value).toMatchObject({
		message: { content: "still here?" },
	});
});

it("setModel() calls session.setModel() with the requested model", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setModel?.("opus");
	expect(harness.setModel).toHaveBeenCalledExactlyOnceWith("opus");
});

it("setPermissionMode() calls session.setPermissionMode() for a recognized mode", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setPermissionMode?.("plan");
	expect(harness.setPermissionMode).toHaveBeenCalledExactlyOnceWith("plan");
});

it("setPermissionMode() ignores an unrecognized mode instead of forwarding it", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setPermissionMode?.("not-a-real-mode");
	expect(harness.setPermissionMode).not.toHaveBeenCalled();
});

it("start(dir, { resume }) passes the resume id through to query()'s options", async () => {
	mockQuery();
	await claudeCodeAdapter.start("/tmp/project", { resume: "claude-session-1" });

	expect(vi.mocked(query)).toHaveBeenLastCalledWith(
		expect.objectContaining({
			options: expect.objectContaining({ resume: "claude-session-1" }),
		})
	);
});

it("start(dir) without resume leaves options.resume undefined", async () => {
	mockQuery();
	await claudeCodeAdapter.start("/tmp/project");

	expect(vi.mocked(query)).toHaveBeenLastCalledWith(
		expect.objectContaining({
			options: expect.objectContaining({ resume: undefined }),
		})
	);
});

it("merges the agent's supportedModels() ids into the session_ready event", async () => {
	// The web model picker lists exactly what the agent reports — sourced from
	// the SDK control channel, not the raw init line, so merged in the adapter.
	const { harness } = mockQuery([
		{ value: "claude-opus-4" },
		{ value: "claude-sonnet-4" },
	]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "system",
		subtype: "init",
		session_id: "sess-1",
		model: "claude-opus-4",
	});

	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "session_ready",
		detail: {
			model: "claude-opus-4",
			models: ["claude-opus-4", "claude-sonnet-4"],
		},
	});
});

it("omits models from session_ready when the agent reports none", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "system",
		subtype: "init",
		session_id: "sess-1",
		model: "claude-opus-4",
	});

	const event = await nextEvent(iterator);
	expect(event).toMatchObject({ kind: "status", status: "session_ready" });
	expect(
		(event as { detail: Record<string, unknown> }).detail.models
	).toBeUndefined();
});

// listSessions() specs live in claude-code-list-sessions.test.ts — split out
// purely to keep this file under the repo's 300-line limit.
