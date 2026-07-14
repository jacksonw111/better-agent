import { expect, it } from "vitest";
import { deriveSessionAttention } from "./session-attention";

const APPROVAL = {
	kind: "approval",
	requestId: "req-1",
	title: "Run command?",
	options: [{ id: "yes", label: "Yes" }],
};
const QUESTION = {
	kind: "question",
	requestId: "q-1",
	title: "Pick one",
	questions: [{ text: "Which?", options: ["a", "b"] }],
};
const USER_MESSAGE = { kind: "message", role: "user", text: "do the thing" };
const ASSISTANT_MESSAGE = { kind: "message", role: "assistant", text: "done" };
const TOOL_STARTED = {
	kind: "tool",
	id: "t1",
	name: "bash",
	status: "started",
};
const TOOL_COMPLETED = {
	kind: "tool",
	id: "t1",
	name: "bash",
	status: "completed",
};

it("reports 'approval' for an unanswered approval request", () => {
	expect(deriveSessionAttention([USER_MESSAGE, APPROVAL], [])).toBe("approval");
});

it("reports 'approval' for an unanswered question request", () => {
	expect(deriveSessionAttention([QUESTION], [])).toBe("approval");
});

it("an approval answered via the commands stream no longer needs attention", () => {
	const answer = { type: "approval", requestId: "req-1", optionId: "yes" };
	// The turn is still blocked-looking (no post-answer events yet), so the
	// user-message rule reports it as processing rather than idle.
	expect(deriveSessionAttention([USER_MESSAGE, APPROVAL], [answer])).toBe(
		"processing"
	);
});

it("a question answered via the answerQuestion control no longer needs attention", () => {
	const answer = {
		type: "control",
		action: "answerQuestion",
		requestId: "q-1",
		answers: [["a"]],
	};
	expect(deriveSessionAttention([ASSISTANT_MESSAGE, QUESTION], [answer])).toBe(
		null
	);
});

it("a cancelled retraction clears the pending approval", () => {
	const retraction = { ...APPROVAL, cancelled: true };
	expect(
		deriveSessionAttention([ASSISTANT_MESSAGE, APPROVAL, retraction], [])
	).toBe(null);
});

it("an answer for a DIFFERENT requestId leaves the approval pending", () => {
	const answer = { type: "approval", requestId: "other", optionId: "yes" };
	expect(deriveSessionAttention([APPROVAL], [answer])).toBe("approval");
});

it("reports 'processing' when the last conversational event is a user message", () => {
	expect(deriveSessionAttention([ASSISTANT_MESSAGE, USER_MESSAGE], [])).toBe(
		"processing"
	);
});

it("reports 'processing' while a tool is still started", () => {
	expect(deriveSessionAttention([USER_MESSAGE, TOOL_STARTED], [])).toBe(
		"processing"
	);
});

it("a completed tool or assistant reply is not processing", () => {
	expect(deriveSessionAttention([USER_MESSAGE, TOOL_COMPLETED], [])).toBe(null);
	expect(deriveSessionAttention([USER_MESSAGE, ASSISTANT_MESSAGE], [])).toBe(
		null
	);
});

it("streaming output means the reply IS the signal — not processing", () => {
	const output = { kind: "output", text: "partial reply" };
	expect(deriveSessionAttention([USER_MESSAGE, output], [])).toBe(null);
});

it("skips status events when scanning for the conversational tail", () => {
	const status = { kind: "status", status: "turn_start" };
	expect(deriveSessionAttention([USER_MESSAGE, status], [])).toBe("processing");
});

it("returns null for empty or malformed tails", () => {
	expect(deriveSessionAttention([], [])).toBe(null);
	expect(deriveSessionAttention(["garbage", 42, null], ["nope"])).toBe(null);
});

it("'approval' wins over 'processing'", () => {
	expect(
		deriveSessionAttention([USER_MESSAGE, TOOL_STARTED, APPROVAL], [])
	).toBe("approval");
});
