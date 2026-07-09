import { describe, expect, it } from "vitest";
import {
	FALLBACK_DENY_OPTION_ID,
	normalizeOpencode,
	normalizeOpencodeApprovalRequest,
} from "./opencode";

describe("normalizeOpencode - message chunks", () => {
	it("maps an agent_message_chunk to an accumulating output event", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				sessionId: "s1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "hi" },
				},
			},
		});
		// output (not message) so the UI accumulates chunks into one bubble,
		// instead of rendering each streamed word as its own message.
		expect(events).toEqual([{ kind: "output", text: "hi", reasoning: false }]);
	});

	it("marks agent_thought_chunk as reasoning output", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: "hmm" },
				},
			},
		});
		expect(events).toEqual([{ kind: "output", text: "hmm", reasoning: true }]);
	});
});

describe("normalizeOpencode - tool calls", () => {
	it("maps a tool_call to a started tool event", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "call_1",
					title: "Read file",
					rawInput: { path: "a.ts" },
				},
			},
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "Read file",
				status: "started",
				input: { path: "a.ts" },
				output: undefined,
			},
		]);
	});

	it("maps a tool_call_update with an explicit status", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "call_1",
					status: "failed",
					content: "error text",
				},
			},
		});
		expect(events[0]).toMatchObject({ status: "failed", output: "error text" });
	});
});

describe("normalizeOpencode - plan and edge cases", () => {
	it("maps a plan update to a status event", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: { sessionUpdate: "plan", entries: [{ content: "step 1" }] },
			},
		});
		expect(events).toEqual([
			{ kind: "status", status: "plan", detail: [{ content: "step 1" }] },
		]);
	});

	it("ignores notifications that aren't session/update", () => {
		expect(
			normalizeOpencode({ method: "session/created", params: {} })
		).toEqual([]);
	});
});

describe("normalizeOpencode - available_commands_update", () => {
	it("maps available_commands_update to a session_ready status event with slashCommands", () => {
		const events = normalizeOpencode({
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "available_commands_update",
					availableCommands: [
						{ name: "explain", description: "Explain the codebase" },
						{ name: "fix-tests", description: "Fix failing tests" },
					],
				},
			},
		});
		expect(events).toEqual([
			{
				kind: "status",
				status: "session_ready",
				detail: { slashCommands: ["explain", "fix-tests"] },
			},
		]);
	});

	it("ignores an available_commands_update with no availableCommands array", () => {
		expect(
			normalizeOpencode({
				method: "session/update",
				params: { update: { sessionUpdate: "available_commands_update" } },
			})
		).toEqual([]);
	});
});

describe("normalizeOpencodeApprovalRequest - empty/unparseable options (RC-T4)", () => {
	it("presents a fallback deny-only card instead of dropping a request with an empty options array", () => {
		const events = normalizeOpencodeApprovalRequest(
			"req_1",
			"session/request_permission",
			{ toolCall: { title: "Run `rm -rf /`" }, options: [] }
		);

		expect(events).toEqual([
			{
				detail: undefined,
				kind: "approval",
				options: [
					{
						id: FALLBACK_DENY_OPTION_ID,
						label: "Deny (no answerable options)",
					},
				],
				requestId: "req_1",
				title: "Run `rm -rf /`",
			},
		]);
	});

	it("presents the same fallback deny-only card when options is missing entirely", () => {
		const events = normalizeOpencodeApprovalRequest(
			"req_1",
			"session/request_permission",
			{ toolCall: {} }
		);

		expect(events[0]?.options).toEqual([
			{ id: FALLBACK_DENY_OPTION_ID, label: "Deny (no answerable options)" },
		]);
	});

	it("still returns [] for a request that isn't session/request_permission at all", () => {
		expect(
			normalizeOpencodeApprovalRequest("req_1", "session/update", {})
		).toEqual([]);
	});
});
