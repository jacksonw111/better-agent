import { describe, expect, it } from "vitest";
import { normalizeClaudeCode } from "./claude-code";

describe("normalizeClaudeCode - system envelope", () => {
	it("maps a system/init line to a curated session_ready status", () => {
		const events = normalizeClaudeCode({
			type: "system",
			subtype: "init",
			session_id: "sess_1",
			model: "claude-opus-4-8",
			slash_commands: ["clear", "compact"],
			skills: ["pdf"],
		});
		expect(events).toEqual([
			{
				kind: "status",
				status: "session_ready",
				detail: {
					sessionId: "sess_1",
					model: "claude-opus-4-8",
					cwd: undefined,
					permissionMode: undefined,
					tools: undefined,
					slashCommands: ["clear", "compact"],
					skills: ["pdf"],
					mcpServers: undefined,
				},
			},
		]);
	});

	it("hides noisy system lines (hooks, thinking_tokens)", () => {
		expect(
			normalizeClaudeCode({ type: "system", subtype: "hook_started" })
		).toEqual([]);
		expect(
			normalizeClaudeCode({ type: "system", subtype: "thinking_tokens" })
		).toEqual([]);
	});
});

describe("normalizeClaudeCode - result envelope", () => {
	it("maps a result line to a curated turn_usage status", () => {
		const events = normalizeClaudeCode({
			type: "result",
			subtype: "success",
			total_cost_usd: 0.01,
			num_turns: 1,
			session_id: "sess_1",
		});
		expect(events).toEqual([
			{
				kind: "status",
				status: "turn_usage",
				detail: {
					costUsd: 0.01,
					numTurns: 1,
					durationMs: undefined,
					usage: undefined,
					isError: false,
					sessionId: "sess_1",
				},
			},
		]);
	});
});

describe("normalizeClaudeCode - stream_event and edge cases", () => {
	it("maps a stream_event text_delta to an output event", () => {
		const events = normalizeClaudeCode({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "text_delta", text: "ab" },
			},
		});
		expect(events).toEqual([{ kind: "output", text: "ab" }]);
	});

	it("maps a stream_event thinking_delta to a reasoning-flagged output event", () => {
		const events = normalizeClaudeCode({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "thinking_delta", thinking: "hmm…" },
			},
		});
		expect(events).toEqual([{ kind: "output", text: "hmm…", reasoning: true }]);
	});

	it("ignores other stream_event delta types", () => {
		expect(
			normalizeClaudeCode({
				type: "stream_event",
				event: {
					type: "content_block_stop",
					delta: { type: "signature_delta" },
				},
			})
		).toEqual([]);
	});

	it("ignores unrecognized envelope types", () => {
		expect(normalizeClaudeCode({ type: "nonsense" })).toEqual([]);
	});

	it("ignores non-object input", () => {
		expect(normalizeClaudeCode("just a string")).toEqual([]);
		expect(normalizeClaudeCode(null)).toEqual([]);
	});
});

describe("normalizeClaudeCode - assistant text and thinking blocks", () => {
	it("drops an assistant text block (already streamed via stream_event)", () => {
		const events = normalizeClaudeCode({
			type: "assistant",
			message: { content: [{ type: "text", text: "hello there" }] },
		});
		expect(events).toEqual([]);
	});

	it("keeps a user text block (tool_result echoes are unaffected)", () => {
		const events = normalizeClaudeCode({
			type: "user",
			message: { content: [{ type: "text", text: "hello there" }] },
		});
		expect(events).toEqual([
			{ kind: "message", role: "user", text: "hello there" },
		]);
	});

	it("drops an assistant thinking block (already streamed via thinking_delta)", () => {
		// Symmetric with text: reasoning streams live via stream_event
		// thinking_delta, and the final assistant message repeats it as a
		// thinking block — dropping it here prevents rendering reasoning twice.
		const events = normalizeClaudeCode({
			type: "assistant",
			message: { content: [{ type: "thinking", thinking: "pondering…" }] },
		});
		expect(events).toEqual([]);
	});

	it("a full thinking turn yields reasoning once (streamed), not duplicated by the final message", () => {
		const streamed = normalizeClaudeCode({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "thinking_delta", thinking: "let me think" },
			},
		});
		const final = normalizeClaudeCode({
			type: "assistant",
			message: {
				content: [
					{ type: "thinking", thinking: "let me think" },
					{ type: "text", text: "the answer" },
					{ type: "tool_use", id: "t1", name: "Read", input: {} },
				],
			},
		});
		// Streamed reasoning survives; the final message contributes ONLY the
		// tool_use (its thinking + text blocks are dropped as duplicates).
		expect(streamed).toEqual([
			{ kind: "output", reasoning: true, text: "let me think" },
		]);
		expect(final).toEqual([
			{ kind: "tool", id: "t1", name: "Read", status: "started", input: {} },
		]);
	});
});

describe("normalizeClaudeCode - assistant tool_use block", () => {
	it("keeps tool_use but drops the sibling text block on an assistant turn", () => {
		const events = normalizeClaudeCode({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "Let me check that file." },
					{
						type: "tool_use",
						id: "toolu_1",
						name: "Read",
						input: { file_path: "a.ts" },
					},
				],
			},
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "toolu_1",
				name: "Read",
				status: "started",
				input: { file_path: "a.ts" },
			},
		]);
	});
});

describe("normalizeClaudeCode - user tool_result block", () => {
	it("maps a user tool_result block to a completed tool event", () => {
		const events = normalizeClaudeCode({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: "file contents",
					},
				],
			},
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "toolu_1",
				name: "toolu_1",
				status: "completed",
				output: "file contents",
			},
		]);
	});

	it("marks a failed tool_result as failed", () => {
		const events = normalizeClaudeCode({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_2",
						content: "boom",
						is_error: true,
					},
				],
			},
		});
		expect(events[0]).toMatchObject({ status: "failed" });
	});
});

// RC-T6: defensive unknown-type audit — an unrecognized top-level `type` (a
// future stream-json line shape) or a non-object line must drop safely
// (empty array), never throw.
describe("normalizeClaudeCode - unknown/malformed input (RC-T6)", () => {
	it("drops an unrecognized top-level type without throwing", () => {
		expect(() =>
			normalizeClaudeCode({ type: "future_line_shape", payload: {} })
		).not.toThrow();
		expect(normalizeClaudeCode({ type: "future_line_shape" })).toEqual([]);
	});

	it("drops a non-object line without throwing", () => {
		expect(() => normalizeClaudeCode("not an object")).not.toThrow();
		expect(normalizeClaudeCode(null)).toEqual([]);
	});
});
