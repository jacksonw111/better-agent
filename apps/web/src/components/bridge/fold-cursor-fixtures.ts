import type { StreamEvent } from "./bridge-events";

// Shared event sequences for the fold-cursor test suite (fold-cursor.test.ts,
// fold-cursor-structure.test.ts). Kept in a non-test module because Biome's
// `noExportsInTest` forbids exporting from a `*.test.ts` file — these are
// folded through TWO different harnesses (one-event-at-a-time in
// fold-cursor.test.ts, randomized multi-event chunks in
// fold-cursor-structure.test.ts) so they live once, here, instead of being
// duplicated per file.

export const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

export const scenario: StreamEvent[] = [
	ev(-1, { kind: "message", role: "user", text: "run the tests" }),
	ev(1, { kind: "output", text: "Sure, " }),
	ev(2, { kind: "output", text: "let me check." }),
	ev(3, {
		kind: "tool",
		id: "t1",
		name: "shell",
		input: { cmd: "ls" },
		status: "started",
	}),
	ev(4, { kind: "status", status: "usage_update", detail: { tokens: 12 } }),
	ev(5, {
		kind: "tool",
		id: "t1",
		name: "shell",
		status: "completed",
		output: "file.txt",
	}),
	ev(6, {
		kind: "status",
		status: "plan",
		detail: [{ content: "Read the code", status: "in_progress" }],
	}),
	ev(7, {
		kind: "status",
		status: "plan",
		detail: [{ content: "Read the code", status: "completed" }],
	}),
	ev(8, { kind: "status", status: "turn_end" }),
	ev(9, { kind: "output", text: "All done." }),
];

export const approvalRetractEvents: StreamEvent[] = [
	ev(1, {
		kind: "approval",
		options: [{ id: "allow", label: "Allow" }],
		requestId: "req_1",
		title: "Run `rm`",
	}),
	ev(2, { kind: "output", text: "meanwhile" }),
	ev(3, {
		kind: "approval",
		cancelled: true,
		options: [],
		requestId: "req_1",
		title: "Cancelled",
	}),
];

export const codexFinalReplacesDeltaEvents: StreamEvent[] = [
	ev(1, { kind: "output", text: "Check", id: "item_1" }),
	ev(2, { kind: "output", text: "ing the file", id: "item_1" }),
	ev(3, {
		kind: "message",
		role: "assistant",
		text: "Checking the file — done.",
		id: "item_1",
	}),
];
