import { describe, expect, it } from "vitest";
import { createCodexNormalizer, normalizeCodex } from "./codex";

describe("normalizeCodex - agentMessage items", () => {
	it("maps an agentMessage item/completed to a message event", () => {
		const events = normalizeCodex({
			method: "item/completed",
			params: { item: { type: "agentMessage", id: "item_1", text: "done" } },
		});
		expect(events).toEqual([
			{ id: "item_1", kind: "message", role: "assistant", text: "done" },
		]);
	});

	// hermes-verified contract (codex_event_projector.py): a message
	// materializes EXACTLY ONCE, on `item/completed`. Streaming deltas are
	// display-only and must NOT emit a renderable event — emitting one
	// alongside the terminal message is what double-rendered every codex reply
	// ("repeated output"). So an ordinary delta yields no events.
	it("drops a streaming agentMessage delta (display-only, no renderable event)", () => {
		const events = normalizeCodex({
			method: "item/agentMessage/delta",
			params: { itemId: "item_1", delta: "Runnin" },
		});
		expect(events).toEqual([]);
	});

	// The empty-bubble bug: codex fires `item/started` with an agentMessage
	// whose text is still empty; materializing it produced a blank assistant
	// bubble. Only the terminal `item/completed` may materialize the message.
	it("does not materialize an agentMessage on item/started", () => {
		const events = normalizeCodex({
			method: "item/started",
			params: { item: { type: "agentMessage", id: "item_1", text: "" } },
		});
		expect(events).toEqual([]);
	});
});

describe("normalizeCodex - commandExecution items", () => {
	it("maps a commandExecution item to a tool event with a joined command", () => {
		const events = normalizeCodex({
			method: "item/started",
			params: {
				item: {
					type: "commandExecution",
					id: "item_2",
					command: ["npm", "test"],
					status: "inProgress",
				},
			},
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "item_2",
				name: "shell",
				status: "started",
				input: "npm test",
			},
		]);
	});
});

describe("normalizeCodex - fileChange items", () => {
	it("maps a fileChange item to one file event per change", () => {
		const events = normalizeCodex({
			method: "item/completed",
			params: {
				item: {
					type: "fileChange",
					id: "item_3",
					changes: [
						{ path: "/repo/a.ts", kind: "modified", diff: "@@ -1 +1 @@" },
						{ path: "/repo/b.ts", kind: "created" },
					],
				},
			},
		});
		expect(events).toEqual([
			{
				kind: "file",
				path: "/repo/a.ts",
				change: "modified",
				diff: "@@ -1 +1 @@",
			},
			{ kind: "file", path: "/repo/b.ts", change: "created", diff: undefined },
		]);
	});

	// R1-T2 §4: pins that a fileChange diff string reaches the normalized
	// event unmodified — the web's FileLine/tool-result path reads this field
	// verbatim (see docs/local-agent-refactor-plan.md R1-T2 item 4).
	it("passes a fileChange entry's diff string through unmodified", () => {
		const diff = "@@ -3,2 +3,3 @@\n-old line\n+new line\n+another line";
		const events = normalizeCodex({
			method: "item/completed",
			params: {
				item: {
					type: "fileChange",
					id: "item_4",
					changes: [{ path: "/repo/c.ts", kind: "modified", diff }],
				},
			},
		});
		expect(events).toEqual([
			{ kind: "file", path: "/repo/c.ts", change: "modified", diff },
		]);
	});
});

describe("normalizeCodex - reasoning items", () => {
	it("materializes a reasoning item's text on item/completed", () => {
		const events = normalizeCodex({
			method: "item/completed",
			params: {
				item: { type: "reasoning", id: "item_5", text: "considering options" },
			},
		});
		expect(events).toEqual([
			{ kind: "output", reasoning: true, text: "considering options" },
		]);
	});

	// Same materialize-once contract as agentMessage (8e2d980): item/started
	// must not render — reasoning text there may still be empty/partial.
	it("does not materialize a reasoning item on item/started", () => {
		const events = normalizeCodex({
			method: "item/started",
			params: { item: { type: "reasoning", id: "item_5", text: "" } },
		});
		expect(events).toEqual([]);
	});
});

describe("normalizeCodex - mcpToolCall/dynamicToolCall items", () => {
	it("maps a started mcpToolCall item to a started tool event (unlike agentMessage, not gated to terminal)", () => {
		const events = normalizeCodex({
			method: "item/started",
			params: {
				item: {
					type: "mcpToolCall",
					id: "call_1",
					tool: "search",
					arguments: { query: "foo" },
					status: "inProgress",
				},
			},
		});
		expect(events).toEqual([
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

	it("degrades an unrecognized mcpToolCall shape to a generic 'mcp' tool card instead of dropping it", () => {
		const events = normalizeCodex({
			method: "item/completed",
			params: {
				item: { type: "mcpToolCall", id: "call_2", status: "completed" },
			},
		});
		expect(events).toEqual([
			{
				id: "call_2",
				input: undefined,
				kind: "tool",
				name: "mcp",
				output: undefined,
				status: "completed",
			},
		]);
	});
});

describe("createCodexNormalizer - adapter-side tool duration", () => {
	it("stamps durationMs on a commandExecution's completed event, measured from its started event", async () => {
		const normalize = createCodexNormalizer();
		normalize({
			method: "item/started",
			params: {
				item: {
					type: "commandExecution",
					id: "item_6",
					command: ["ls"],
					status: "inProgress",
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		const [event] = normalize({
			method: "item/completed",
			params: {
				item: {
					type: "commandExecution",
					id: "item_6",
					command: ["ls"],
					status: "completed",
				},
			},
		});
		expect(event).toMatchObject({ id: "item_6", status: "completed" });
		expect(typeof (event as { durationMs?: number }).durationMs).toBe("number");
		expect((event as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(
			0
		);
	});

	it("leaves a non-tool event untouched", () => {
		const normalize = createCodexNormalizer();
		const events = normalize({
			method: "item/completed",
			params: { item: { type: "agentMessage", id: "item_7", text: "done" } },
		});
		expect(events).toEqual([
			{ id: "item_7", kind: "message", role: "assistant", text: "done" },
		]);
	});
});

describe("normalizeCodex - turn notifications and edge cases", () => {
	it("maps turn/completed and turn/failed to status/error events", () => {
		expect(
			normalizeCodex({
				method: "turn/completed",
				params: { turn: { id: "t1" } },
			})
		).toEqual([
			{ kind: "status", status: "turn_completed", detail: { id: "t1" } },
		]);
		expect(
			normalizeCodex({ method: "turn/failed", params: { error: "boom" } })
		).toEqual([{ kind: "error", message: "boom", detail: "boom" }]);
	});

	it("ignores notifications with no params object", () => {
		expect(normalizeCodex({ method: "item/started" })).toEqual([]);
	});
});

describe("normalizeCodex - <turn_aborted> marker (RC-T6)", () => {
	it("ends the turn cleanly when item/completed's agentMessage text is a raw <turn_aborted> marker", () => {
		const events = normalizeCodex({
			method: "item/completed",
			params: {
				item: { type: "agentMessage", id: "item_1", text: "<turn_aborted>" },
			},
		});
		expect(events).toEqual([
			{
				id: "item_1",
				kind: "message",
				role: "assistant",
				text: "<turn_aborted>",
			},
			{
				kind: "status",
				status: "turn_completed",
				detail: { turnAborted: true },
			},
		]);
	});

	it("ends the turn cleanly when the marker arrives inside a streamed delta instead", () => {
		const events = normalizeCodex({
			method: "item/agentMessage/delta",
			params: { itemId: "item_1", delta: "<turn_aborted/>" },
		});
		// The delta itself stays display-only (no renderable output event); only
		// the synthetic turn-terminal status is surfaced so the turn can't hang.
		expect(events).toEqual([
			{
				kind: "status",
				status: "turn_completed",
				detail: { turnAborted: true },
			},
		]);
	});

	it("does not treat ordinary agentMessage text as an abort marker", () => {
		const events = normalizeCodex({
			method: "item/completed",
			params: { item: { type: "agentMessage", id: "item_1", text: "done" } },
		});
		expect(events).toEqual([
			{ id: "item_1", kind: "message", role: "assistant", text: "done" },
		]);
	});
});
