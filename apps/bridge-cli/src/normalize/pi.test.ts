import { describe, expect, it } from "vitest";
import { normalizePi, normalizePiExtensionUiRequest } from "./pi";

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

describe("normalizePiExtensionUiRequest (RC-T4) - select/confirm map to a card", () => {
	it("maps a select request to an ApprovalEvent whose option ids are the option labels", () => {
		const events = normalizePiExtensionUiRequest({
			type: "extension_ui_request",
			id: "req-1",
			method: "select",
			title: "Allow dangerous command?",
			options: ["Allow", "Block"],
		});
		expect(events).toEqual([
			{
				detail: undefined,
				kind: "approval",
				options: [
					{ id: "Allow", label: "Allow" },
					{ id: "Block", label: "Block" },
				],
				requestId: "req-1",
				title: "Allow dangerous command?",
			},
		]);
	});

	it("maps a confirm request to an ApprovalEvent with fixed confirmed/declined options", () => {
		const events = normalizePiExtensionUiRequest({
			type: "extension_ui_request",
			id: "req-2",
			method: "confirm",
			title: "Clear session?",
			message: "All messages will be lost.",
		});
		expect(events).toEqual([
			{
				detail: "All messages will be lost.",
				kind: "approval",
				options: [
					{ id: "confirmed", label: "Confirm" },
					{ id: "declined", label: "Decline" },
				],
				requestId: "req-2",
				title: "Clear session?",
			},
		]);
	});
});

describe("normalizePiExtensionUiRequest (RC-T4) - non-representable/malformed input", () => {
	it("returns [] for input/editor methods — free-form text has no deny analog", () => {
		expect(
			normalizePiExtensionUiRequest({
				type: "extension_ui_request",
				id: "req-3",
				method: "input",
				title: "Enter a value",
			})
		).toEqual([]);
		expect(
			normalizePiExtensionUiRequest({
				type: "extension_ui_request",
				id: "req-4",
				method: "editor",
				title: "Edit some text",
			})
		).toEqual([]);
	});

	it("returns [] for a malformed select with no usable string options", () => {
		expect(
			normalizePiExtensionUiRequest({
				type: "extension_ui_request",
				id: "req-5",
				method: "select",
				title: "Pick one",
				options: [],
			})
		).toEqual([]);
	});

	it("returns [] for a non-extension_ui_request line", () => {
		expect(normalizePiExtensionUiRequest({ type: "agent_start" })).toEqual([]);
	});
});
