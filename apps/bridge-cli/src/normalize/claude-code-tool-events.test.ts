// Split out of claude-code.test.ts to keep that file under the repo's
// 300-line cap — covers tool_use/tool_result block mapping (plain
// normalizeClaudeCode) plus R1-T2's createClaudeCodeNormalizer stateful
// adapter-side duration tracking on top of them.

import { describe, expect, it } from "vitest";
import { createClaudeCodeNormalizer, normalizeClaudeCode } from "./claude-code";

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

describe("createClaudeCodeNormalizer - adapter-side tool duration", () => {
	it("stamps durationMs on the matching tool_result, keyed by tool_use_id/id", async () => {
		const normalize = createClaudeCodeNormalizer();
		normalize({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }],
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		const events = normalize({
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
		expect(events[0]).toMatchObject({ id: "toolu_1", status: "completed" });
		expect(typeof (events[0] as { durationMs?: number }).durationMs).toBe(
			"number"
		);
		expect(
			(events[0] as { durationMs: number }).durationMs
		).toBeGreaterThanOrEqual(0);
	});

	it("still returns the tool_use started event itself, unaffected by duration tracking", () => {
		const normalize = createClaudeCodeNormalizer();
		const events = normalize({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }],
			},
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "toolu_1",
				name: "Read",
				status: "started",
				input: {},
			},
		]);
	});
});
