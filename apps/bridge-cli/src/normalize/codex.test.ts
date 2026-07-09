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

	it("maps an agentMessage delta to an output event", () => {
		const events = normalizeCodex({
			method: "item/agentMessage/delta",
			params: { itemId: "item_1", delta: "Runnin" },
		});
		expect(events).toEqual([{ id: "item_1", kind: "output", text: "Runnin" }]);
	});

	// The double-render bug: without a shared id, the web can't tell a
	// streamed delta and its final message are the SAME logical message, so
	// it renders both — see bridge-turns.test.ts for the reducer-level proof.
	it("shares the item id between a streamed delta and the item's final message", () => {
		const delta = normalizeCodex({
			method: "item/agentMessage/delta",
			params: { itemId: "item_1", delta: "Runnin" },
		})[0] as { id?: string };
		const final = normalizeCodex({
			method: "item/completed",
			params: {
				item: { type: "agentMessage", id: "item_1", text: "Running tests" },
			},
		})[0] as { id?: string };
		expect(delta.id).toBe("item_1");
		expect(final.id).toBe("item_1");
		expect(delta.id).toBe(final.id);
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
