import { describe, expect, it } from "vitest";
import { normalizeCodex } from "./codex";

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
