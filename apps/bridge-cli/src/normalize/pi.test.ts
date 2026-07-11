import { describe, expect, it } from "vitest";
import { normalizePi } from "./pi";

describe("normalizePi - message_update text_delta", () => {
	it("maps a text_delta assistantMessageEvent to an output event", () => {
		const events = normalizePi({
			type: "message_update",
			message: {},
			assistantMessageEvent: { type: "text_delta", delta: "Hello " },
		});
		expect(events).toEqual([{ kind: "output", text: "Hello " }]);
	});

	it("ignores non-text_delta assistantMessageEvent subtypes", () => {
		expect(
			normalizePi({
				type: "message_update",
				assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
			})
		).toEqual([]);
	});
});

describe("normalizePi - message_end", () => {
	it("drops the final text block (already streamed) but keeps thinking", () => {
		const events = normalizePi({
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "Done." },
					{ type: "thinking", thinking: "pondering…" },
					{ type: "toolCall", id: "call_1", name: "bash", arguments: {} },
				],
			},
		});
		// The text streamed live via message_update text_delta, so the final
		// text block is dropped to avoid rendering the reply twice; thinking
		// (not streamed) is kept.
		expect(events).toEqual([
			{
				kind: "message",
				role: "assistant",
				text: "pondering…",
				thinking: true,
			},
		]);
	});

	it("ignores non-assistant messages", () => {
		expect(
			normalizePi({
				type: "message_end",
				message: { role: "user", content: "hi" },
			})
		).toEqual([]);
	});

	it("maps a plain string assistant message body", () => {
		expect(
			normalizePi({
				type: "message_end",
				message: { role: "assistant", content: "plain text" },
			})
		).toEqual([{ kind: "message", role: "assistant", text: "plain text" }]);
	});
});

// tool_execution_start/_end (plain normalizePi) and createPiNormalizer's
// tool_execution_update/duration tracking now live in pi-tool-events.test.ts,
// split out to keep this file under the 300-line cap.

describe("normalizePi - lifecycle status passthrough", () => {
	it("maps agent_start/agent_end/turn_start/turn_end to status events", () => {
		expect(normalizePi({ type: "agent_start" })).toEqual([
			{
				kind: "status",
				status: "agent_start",
				detail: { type: "agent_start" },
			},
		]);
		expect(
			normalizePi({ type: "turn_end", message: {}, toolResults: [] })
		).toEqual([
			{
				kind: "status",
				status: "turn_end",
				detail: { type: "turn_end", message: {}, toolResults: [] },
			},
		]);
	});
});

describe("normalizePi - response failures", () => {
	it("maps a success:false response to an error event", () => {
		const events = normalizePi({
			type: "response",
			command: "set_model",
			success: false,
			id: "req-1",
			error: "Model not found",
		});
		expect(events).toEqual([
			{ kind: "error", message: "Model not found", detail: "Model not found" },
		]);
	});

	it("ignores a successful response", () => {
		expect(
			normalizePi({
				type: "response",
				command: "prompt",
				success: true,
				id: "req-1",
			})
		).toEqual([]);
	});
});

describe("normalizePi - edge cases", () => {
	it("ignores unrecognized event types", () => {
		expect(normalizePi({ type: "nonsense" })).toEqual([]);
	});

	it("ignores non-object input", () => {
		expect(normalizePi("just a string")).toEqual([]);
		expect(normalizePi(null)).toEqual([]);
	});

	it("never surfaces extension_ui_request through the generic dispatch (routed separately, see adapters/pi-approvals.ts)", () => {
		expect(
			normalizePi({
				type: "extension_ui_request",
				id: "req-1",
				method: "confirm",
			})
		).toEqual([]);
	});
});

// normalizePiExtensionUiRequest (RC-T4) tests moved to
// pi-extension-ui.test.ts alongside the module it now lives in.

// RC-T6: defensive unknown-type audit — an unrecognized top-level `type` (a
// future pi event) or a non-object line must drop safely, never throw.
describe("normalizePi - unknown/malformed input (RC-T6)", () => {
	it("drops an unrecognized top-level type without throwing", () => {
		expect(() => normalizePi({ type: "future_event_type" })).not.toThrow();
		expect(normalizePi({ type: "future_event_type" })).toEqual([]);
	});

	it("drops a non-object line without throwing", () => {
		expect(() => normalizePi("not an object")).not.toThrow();
		expect(normalizePi(null)).toEqual([]);
	});
});
