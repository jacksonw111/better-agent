import { describe, expect, it } from "vitest";
import {
	createOpencodeServeNormalizer,
	parseOpencodeServeModels,
} from "./opencode-serve";

const SESSION_ID = "ses_1";

/** Wraps a part in the assumed `message.part.updated` SSE envelope. */
function partEvent(part: Record<string, unknown>): Record<string, unknown> {
	return {
		type: "message.part.updated",
		properties: { part: { sessionID: SESSION_ID, ...part } },
	};
}

describe("createOpencodeServeNormalizer - text parts", () => {
	it("turns accumulated text-part snapshots into output deltas", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);

		expect(
			normalize(partEvent({ id: "prt_1", type: "text", text: "Hel" }))
		).toEqual([{ kind: "output", text: "Hel", reasoning: false }]);
		expect(
			normalize(partEvent({ id: "prt_1", type: "text", text: "Hello" }))
		).toEqual([{ kind: "output", text: "lo", reasoning: false }]);
		// an unchanged snapshot re-send emits nothing
		expect(
			normalize(partEvent({ id: "prt_1", type: "text", text: "Hello" }))
		).toEqual([]);
	});

	it("falls back to the full text when a snapshot is not a prefix extension", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		normalize(partEvent({ id: "prt_1", type: "text", text: "draft" }));

		const events = normalize(
			partEvent({ id: "prt_1", type: "text", text: "rewritten" })
		);
		expect(events).toEqual([
			{ kind: "output", text: "rewritten", reasoning: false },
		]);
	});

	it("marks reasoning parts as reasoning output", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize(
			partEvent({ id: "prt_2", type: "reasoning", text: "hmm" })
		);
		expect(events).toEqual([{ kind: "output", text: "hmm", reasoning: true }]);
	});
});

describe("createOpencodeServeNormalizer - tool parts", () => {
	it("maps a running tool part to a started tool event", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize(
			partEvent({
				type: "tool",
				callID: "call_1",
				tool: "bash",
				state: { status: "running", input: { command: "ls" } },
			})
		);
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "started",
				input: { command: "ls" },
				output: undefined,
			},
		]);
	});

	it("maps completed and error states to completed/failed", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const completed = normalize(
			partEvent({
				type: "tool",
				callID: "call_1",
				tool: "bash",
				state: { status: "completed", output: "ok" },
			})
		);
		expect(completed[0]).toMatchObject({ status: "completed", output: "ok" });

		const failed = normalize(
			partEvent({
				type: "tool",
				callID: "call_2",
				tool: "bash",
				state: { status: "error", error: "boom" },
			})
		);
		expect(failed[0]).toMatchObject({ status: "failed", output: "boom" });
	});
});

describe("createOpencodeServeNormalizer - tool title/duration (R1-T2)", () => {
	it("maps state.title and computes durationMs from state.time.{start,end} on completed", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize(
			partEvent({
				type: "tool",
				callID: "call_1",
				tool: "read",
				state: {
					status: "completed",
					output: "file contents",
					title: "Read src/app.ts",
					time: { start: 1000, end: 1250 },
				},
			})
		);
		expect(events[0]).toMatchObject({
			title: "Read src/app.ts",
			durationMs: 250,
		});
	});

	it("leaves durationMs unset when the tool is still running (no state.time.end yet)", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize(
			partEvent({
				type: "tool",
				callID: "call_1",
				tool: "read",
				state: {
					status: "running",
					title: "Read src/app.ts",
					time: { start: 1000 },
				},
			})
		);
		expect(events[0]).toMatchObject({ title: "Read src/app.ts" });
		expect((events[0] as { durationMs?: number }).durationMs).toBeUndefined();
	});
});

describe("createOpencodeServeNormalizer - usage", () => {
	it("maps a step-finish part to a usage_update status with summed tokens and cost", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize(
			partEvent({
				type: "step-finish",
				cost: 0.42,
				tokens: {
					input: 100,
					output: 20,
					reasoning: 5,
					cache: { read: 10, write: 2 },
				},
			})
		);
		expect(events).toEqual([
			{
				kind: "status",
				status: "usage_update",
				detail: { used: 137, cost: { amount: 0.42 } },
			},
		]);
	});
});

describe("createOpencodeServeNormalizer - permissions & lifecycle", () => {
	it("maps a permission.updated event to an approval with the fixed once/always/reject options", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize({
			type: "permission.updated",
			properties: {
				id: "perm_1",
				sessionID: SESSION_ID,
				title: "Run `ls`",
				metadata: { command: "ls" },
			},
		});
		expect(events).toEqual([
			{
				detail: JSON.stringify({ command: "ls" }),
				kind: "approval",
				options: [
					{ id: "once", label: "Allow" },
					{ id: "always", label: "Always allow" },
					{ id: "reject", label: "Deny" },
				],
				requestId: "perm_1",
				title: "Run `ls`",
			},
		]);
	});

	it("maps session.error to an error event", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize({
			type: "session.error",
			properties: { sessionID: SESSION_ID, error: { name: "ProviderError" } },
		});
		expect(events).toEqual([
			{
				kind: "error",
				message: "opencode session error",
				detail: { name: "ProviderError" },
			},
		]);
	});

	it("maps session.idle to a turn_end status", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize({
			type: "session.idle",
			properties: { sessionID: SESSION_ID },
		});
		expect(events).toEqual([{ kind: "status", status: "turn_end" }]);
	});
});

describe("createOpencodeServeNormalizer - filtering", () => {
	it("drops events that name a different session", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		const events = normalize({
			type: "message.part.updated",
			properties: {
				part: { sessionID: "ses_other", id: "prt_9", type: "text", text: "x" },
			},
		});
		expect(events).toEqual([]);
	});

	it("drops unknown event types instead of passing them through as status", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);
		expect(
			normalize({ type: "storage.write", properties: { key: "k" } })
		).toEqual([]);
		expect(normalize("not an object")).toEqual([]);
	});
});

describe("parseOpencodeServeModels", () => {
	it("flattens providers into provider/model strings", () => {
		const models = parseOpencodeServeModels({
			providers: [
				{
					id: "anthropic",
					models: { "claude-sonnet-4": {}, "claude-haiku": {} },
				},
				{ id: "openai", models: { "gpt-5": {} } },
			],
		});
		expect(models).toEqual([
			"anthropic/claude-sonnet-4",
			"anthropic/claude-haiku",
			"openai/gpt-5",
		]);
	});

	it("returns [] for an off-shape body", () => {
		expect(parseOpencodeServeModels(undefined)).toEqual([]);
		expect(parseOpencodeServeModels({ providers: [{ id: 1 }] })).toEqual([]);
	});
});
