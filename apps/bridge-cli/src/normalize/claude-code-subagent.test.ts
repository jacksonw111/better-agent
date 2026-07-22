import { describe, expect, it } from "vitest";
import { normalizeClaudeCode } from "./claude-code";
import type { NormalizedEvent } from "./types";

// Regression fixture for the "subagent output rendered as user messages" bug.
// These frames are copied verbatim from real `claude` stream-json output
// (claude 2.1.211, `-p --output-format stream-json --verbose`) for a prompt
// that dispatches a Task/Agent subagent to read a file and report back. The
// full 18-frame capture and analysis lives in
// .superpowers/sdd/fix-subagent-role-report.md.
//
// The bug: the `type:"user"` frame the SDK emits for the subagent's injected
// task prompt (FRAME 8 — a byte-for-byte duplicate of the Agent tool_use's
// `prompt` input, with `parent_tool_use_id` pointing at that tool call) was
// normalized to `{kind:"message", role:"user"}` and shown in the web chat as a
// message the human typed. A `type:"user"` frame is never the human's live
// input — that is pushed separately as a userMessageEvent from the adapter's
// send() — so it must never yield a role:"user" message.

const AGENT_TOOL_ID = "toolu_01AQHw3uRmSTxfQsVXSgX3Ef";
const SUBAGENT_READ_ID = "toolu_01NrXVfsnfqchaEqqF1U8McY";

// FRAME 6: the main agent invokes the Task/Agent tool. Its `prompt` input is
// the subagent's instruction — the same text FRAME 8 later echoes.
const agentToolUseFrame = {
	type: "assistant",
	parent_tool_use_id: null,
	message: {
		content: [
			{
				type: "tool_use",
				id: AGENT_TOOL_ID,
				name: "Agent",
				input: {
					description: "Read target.txt for secret ingredient",
					prompt:
						"Read the file `target.txt` and report the secret ingredient.",
					subagent_type: "general-purpose",
				},
			},
		],
	},
};

// FRAME 8: THE BUG — the subagent's injected task prompt, echoed as its first
// user turn (nested under the Agent tool via `parent_tool_use_id`).
const subagentPromptFrame = {
	type: "user",
	parent_tool_use_id: AGENT_TOOL_ID,
	message: {
		content: [
			{
				type: "text",
				text: "Read the file `target.txt` and report the secret ingredient.",
			},
		],
	},
};

// FRAME 12: a tool_result INSIDE the subagent (its Read call's output).
const subagentToolResultFrame = {
	type: "user",
	parent_tool_use_id: AGENT_TOOL_ID,
	message: {
		content: [
			{
				tool_use_id: SUBAGENT_READ_ID,
				type: "tool_result",
				content: "1\tThe secret ingredient is caramelized fennel.\n",
			},
		],
	},
};

// FRAME 15: the Agent tool's final result back to the MAIN agent (top-level,
// `parent_tool_use_id` null).
const agentToolResultFrame = {
	type: "user",
	parent_tool_use_id: null,
	message: {
		content: [
			{
				tool_use_id: AGENT_TOOL_ID,
				type: "tool_result",
				content: [{ type: "text", text: "caramelized fennel" }],
			},
		],
	},
};

const messages = (events: NormalizedEvent[]) =>
	events.filter((event) => event.kind === "message");

describe("normalizeClaudeCode - Task subagent dispatch (real frames)", () => {
	it("does NOT render the subagent's injected task prompt as a user message", () => {
		// The core regression: this user-frame text block must produce no message.
		expect(normalizeClaudeCode(subagentPromptFrame)).toEqual([]);
	});

	it("across the whole dispatch, emits no role:user message at all", () => {
		const frames = [
			agentToolUseFrame,
			subagentPromptFrame,
			subagentToolResultFrame,
			agentToolResultFrame,
		];
		const all = frames.flatMap((frame) => normalizeClaudeCode(frame));
		expect(messages(all)).toEqual([]);
		expect(all.some((e) => e.kind === "message" && e.role === "user")).toBe(
			false
		);
	});
});

// Split from the block above purely to stay under the repo's
// max-lines-per-function (50) gate: the subagent dispatch's tool events must
// keep their existing behavior — only the mislabeled user MESSAGE is fixed.
describe("normalizeClaudeCode - Task subagent dispatch tool events (real frames)", () => {
	it("still surfaces the Task tool call itself as a started tool event", () => {
		expect(normalizeClaudeCode(agentToolUseFrame)).toEqual([
			{
				kind: "tool",
				id: AGENT_TOOL_ID,
				name: "Agent",
				status: "started",
				input: {
					description: "Read target.txt for secret ingredient",
					prompt:
						"Read the file `target.txt` and report the secret ingredient.",
					subagent_type: "general-purpose",
				},
			},
		]);
	});

	it("preserves tool_result behavior — the subagent's Read result is a completed tool event", () => {
		expect(normalizeClaudeCode(subagentToolResultFrame)).toEqual([
			{
				kind: "tool",
				id: SUBAGENT_READ_ID,
				name: SUBAGENT_READ_ID,
				status: "completed",
				output: "1\tThe secret ingredient is caramelized fennel.\n",
			},
		]);
	});

	it("preserves tool_result behavior — the Agent tool's final result is a completed tool event", () => {
		expect(normalizeClaudeCode(agentToolResultFrame)).toEqual([
			{
				kind: "tool",
				id: AGENT_TOOL_ID,
				name: AGENT_TOOL_ID,
				status: "completed",
				output: [{ type: "text", text: "caramelized fennel" }],
			},
		]);
	});
});
