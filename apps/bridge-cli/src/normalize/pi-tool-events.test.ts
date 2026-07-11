// Split out of pi.test.ts to keep that file under the repo's 300-line cap —
// covers the tool_execution_* wire lines (plain normalizePi's start/end
// mapping, plus R1-T2's createPiNormalizer stateful running-preview/duration
// tracking on top of them).

import { describe, expect, it } from "vitest";
import { createPiNormalizer, normalizePi } from "./pi";

describe("normalizePi - tool_execution_start", () => {
	it("maps tool_execution_start to a started tool event", () => {
		const events = normalizePi({
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "bash",
			args: { command: "ls" },
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "started",
				input: { command: "ls" },
			},
		]);
	});
});

describe("normalizePi - tool_execution_end", () => {
	it("maps tool_execution_end with isError to a failed tool event", () => {
		const events = normalizePi({
			type: "tool_execution_end",
			toolCallId: "call_1",
			toolName: "bash",
			result: "boom",
			isError: true,
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "failed",
				output: "boom",
			},
		]);
	});

	it("maps tool_execution_end without isError to a completed tool event", () => {
		const events = normalizePi({
			type: "tool_execution_end",
			toolCallId: "call_1",
			toolName: "bash",
			result: "ok",
			isError: false,
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "completed",
				output: "ok",
			},
		]);
	});
});

describe("createPiNormalizer - tool_execution_update (running preview)", () => {
	it("recalls the tool name cached from tool_execution_start and attaches a flattened preview", () => {
		const normalize = createPiNormalizer();
		normalize({
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "bash",
			args: { command: "ls" },
		});
		const events = normalize({
			type: "tool_execution_update",
			toolCallId: "call_1",
			partialResult: "partial output so far",
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "started",
				preview: "partial output so far",
			},
		]);
	});

	it("REPLACEs the preview on each update rather than appending — the latest update wins", () => {
		const normalize = createPiNormalizer();
		normalize({
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "bash",
			args: {},
		});
		normalize({
			type: "tool_execution_update",
			toolCallId: "call_1",
			partialResult: "first chunk",
		});
		const [second] = normalize({
			type: "tool_execution_update",
			toolCallId: "call_1",
			partialResult: "first chunk plus more",
		});
		expect(second).toMatchObject({ preview: "first chunk plus more" });
	});
});

describe("createPiNormalizer - tool_execution_update edge cases", () => {
	it("flattens an object partialResult via its text/output/result field", () => {
		const normalize = createPiNormalizer();
		normalize({
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "bash",
			args: {},
		});
		const [event] = normalize({
			type: "tool_execution_update",
			toolCallId: "call_1",
			partialResult: { output: "streamed so far" },
		});
		expect(event).toMatchObject({ preview: "streamed so far" });
	});

	it("drops an update for an id that never had a tool_execution_start — no name to recall", () => {
		const normalize = createPiNormalizer();
		expect(
			normalize({
				type: "tool_execution_update",
				toolCallId: "call_unknown",
				partialResult: "x",
			})
		).toEqual([]);
	});
});

describe("createPiNormalizer - adapter-side tool duration", () => {
	it("stamps durationMs on tool_execution_end, measured from the matching tool_execution_start", async () => {
		const normalize = createPiNormalizer();
		normalize({
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "bash",
			args: {},
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		const [event] = normalize({
			type: "tool_execution_end",
			toolCallId: "call_1",
			toolName: "bash",
			result: "ok",
			isError: false,
		});
		expect(event).toMatchObject({ id: "call_1", status: "completed" });
		expect(typeof (event as { durationMs?: number }).durationMs).toBe("number");
		expect((event as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(
			0
		);
	});

	it("still returns the tool_execution_start event itself, unaffected by duration tracking", () => {
		const normalize = createPiNormalizer();
		const events = normalize({
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "bash",
			args: { command: "ls" },
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "started",
				input: { command: "ls" },
			},
		]);
	});
});
