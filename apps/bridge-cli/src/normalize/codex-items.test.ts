import { describe, expect, it } from "vitest";
import {
	normalizeCodexMcpToolCallItem,
	normalizeCodexReasoningItem,
} from "./codex-items";

describe("normalizeCodexReasoningItem", () => {
	it("maps a completed reasoning item's text to a reasoning output event", () => {
		expect(
			normalizeCodexReasoningItem({
				type: "reasoning",
				id: "item_1",
				text: "thinking it through…",
			})
		).toEqual([
			{ kind: "output", reasoning: true, text: "thinking it through…" },
		]);
	});

	it("drops a reasoning item with no text", () => {
		expect(
			normalizeCodexReasoningItem({ type: "reasoning", id: "item_1" })
		).toEqual([]);
	});
});

describe("normalizeCodexMcpToolCallItem - started/completed pair", () => {
	it("maps a started mcpToolCall to a started tool event", () => {
		expect(
			normalizeCodexMcpToolCallItem({
				type: "mcpToolCall",
				id: "call_1",
				tool: "search",
				arguments: { query: "foo" },
				status: "inProgress",
			})
		).toEqual([
			{
				id: "call_1",
				input: { query: "foo" },
				kind: "tool",
				name: "search",
				output: undefined,
				status: "started",
			},
		]);
	});

	it("maps a completed mcpToolCall to a completed tool event with output", () => {
		expect(
			normalizeCodexMcpToolCallItem({
				type: "mcpToolCall",
				id: "call_1",
				tool: "search",
				output: { results: [] },
				status: "completed",
			})
		).toEqual([
			{
				id: "call_1",
				input: undefined,
				kind: "tool",
				name: "search",
				output: { results: [] },
				status: "completed",
			},
		]);
	});
});

describe("normalizeCodexMcpToolCallItem - dynamicToolCall variant", () => {
	it("maps a dynamicToolCall the same way", () => {
		expect(
			normalizeCodexMcpToolCallItem({
				type: "dynamicToolCall",
				id: "call_2",
				name: "dyn_tool",
				input: { a: 1 },
				result: "ok",
				status: "completed",
			})
		).toEqual([
			{
				id: "call_2",
				input: { a: 1 },
				kind: "tool",
				name: "dyn_tool",
				output: "ok",
				status: "completed",
			},
		]);
	});
});

describe("normalizeCodexMcpToolCallItem - defensive/unknown shape", () => {
	it("degrades to a generic 'mcp' name instead of dropping when tool/name are absent", () => {
		expect(
			normalizeCodexMcpToolCallItem({
				type: "mcpToolCall",
				id: "call_3",
				status: "inProgress",
			})
		).toEqual([
			{
				id: "call_3",
				input: undefined,
				kind: "tool",
				name: "mcp",
				output: undefined,
				status: "started",
			},
		]);
	});

	it("drops entirely when the item has no id at all — no way to render a valid ToolEvent", () => {
		expect(
			normalizeCodexMcpToolCallItem({ type: "mcpToolCall", tool: "search" })
		).toEqual([]);
	});
});
