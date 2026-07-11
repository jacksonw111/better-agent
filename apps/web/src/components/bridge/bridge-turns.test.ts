import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	type AssistantTurn,
	type BridgeTurn,
	foldEventsToTurns,
	type UserTurn,
} from "./bridge-turns";
import { feedReducer, initialFeedState } from "./use-bridge-feed";

// Not grouped under a `describe` — mirrors terminal.test.tsx: the repo's
// max-lines-per-function gate counts a wrapping describe callback's body too.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

const asAssistant = (turn: BridgeTurn): AssistantTurn => {
	if (turn.kind !== "assistant") {
		throw new Error(`expected an assistant turn, got ${turn.kind}`);
	}
	return turn;
};

it("accumulates consecutive output deltas into one assistant bubble", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "Hel" }),
		ev(2, { kind: "output", text: "lo " }),
		ev(3, { kind: "output", text: "world" }),
	]);
	expect(turns).toHaveLength(1);
	const assistant = asAssistant(turns[0]);
	expect(assistant.blocks).toEqual([{ kind: "text", text: "Hello world" }]);
	// The trailing open turn streams (caret shows) until a boundary closes it.
	expect(assistant.streaming).toBe(true);
});

it("folds a tool start+end into a single completed tool block", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "tool",
			id: "t1",
			name: "shell",
			input: { cmd: "ls" },
			status: "started",
		}),
		ev(2, {
			kind: "tool",
			id: "t1",
			name: "shell",
			status: "completed",
			output: "file.txt",
		}),
	]);
	expect(turns).toHaveLength(1);
	const [block] = asAssistant(turns[0]).blocks;
	expect(block.kind).toBe("tool");
	if (block.kind === "tool") {
		expect(block.tool).toMatchObject({
			callId: "t1",
			toolName: "shell",
			args: { cmd: "ls" },
			result: "file.txt",
			status: "complete",
			isError: false,
		});
	}
});

it("marks a failed tool as an errored block", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "tool", id: "t1", name: "shell", status: "started" }),
		ev(2, {
			kind: "tool",
			id: "t1",
			name: "shell",
			status: "failed",
			output: "boom",
		}),
	]);
	const [block] = asAssistant(turns[0]).blocks;
	if (block.kind === "tool") {
		expect(block.tool.status).toBe("error");
		expect(block.tool.isError).toBe(true);
	}
});

it("renders a user echo and the assistant reply as distinct turns", () => {
	const turns = foldEventsToTurns([
		ev(-1, { kind: "message", role: "user", text: "hi" }),
		ev(1, { kind: "output", text: "hello" }),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["user", "assistant"]);
	expect((turns[0] as UserTurn).text).toBe("hi");
	expect(asAssistant(turns[1]).blocks).toEqual([
		{ kind: "text", text: "hello" },
	]);
});

it("closes the assistant bubble at a status boundary, preserving order", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "first" }),
		ev(2, { kind: "status", status: "turn-end" }),
		ev(3, { kind: "output", text: "second" }),
	]);
	expect(turns.map((t) => t.kind)).toEqual([
		"assistant",
		"status",
		"assistant",
	]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "first" },
	]);
	expect(asAssistant(turns[0]).streaming).toBe(false);
	expect(asAssistant(turns[2]).blocks).toEqual([
		{ kind: "text", text: "second" },
	]);
	expect(asAssistant(turns[2]).streaming).toBe(true);
});

it("keeps a thinking message as its own reasoning turn", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "message",
			role: "assistant",
			text: "pondering",
			thinking: true,
		}),
	]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "reasoning", text: "pondering" },
	]);
});

it("accumulates reasoning-flagged output into its own collapsible thinking block", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "I sh", reasoning: true }),
		ev(2, { kind: "output", text: "ould check", reasoning: true }),
		ev(3, { kind: "output", text: " the file.", reasoning: true }),
	]);
	expect(turns).toHaveLength(1);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "reasoning", text: "I should check the file." },
	]);
});

it("keeps reasoning and reply output in separate blocks, with no duplication", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "thinking…", reasoning: true }),
		ev(2, { kind: "output", text: "Here you go." }),
	]);
	expect(turns).toHaveLength(1);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "reasoning", text: "thinking…" },
		{ kind: "text", text: "Here you go." },
	]);
});

it("hides session_ready/turn_usage/command_catalog AND does not let them fragment the assistant bubble", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "first" }),
		ev(2, {
			kind: "status",
			status: "session_ready",
			detail: { model: "claude-opus-4-6" },
		}),
		ev(3, { kind: "output", text: "second" }),
		ev(4, {
			kind: "status",
			status: "turn_usage",
			detail: { costUsd: 0.01 },
		}),
		ev(5, {
			kind: "status",
			status: "command_catalog",
			detail: { commands: [{ name: "compact" }] },
		}),
		ev(6, { kind: "status", status: "some-other-status" }),
	]);
	// Hidden non-boundary heartbeats interleave mid-stream (opencode fires one
	// per session/update) and must NOT split a reply: the two outputs merge
	// into ONE bubble. Only the displayed status closes it + shows as a turn.
	expect(turns.map((t) => t.kind)).toEqual(["assistant", "status"]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "firstsecond" },
	]);
});

it("flattens an opencode content-array tool output instead of rendering it empty", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "tool", id: "t1", name: "shell", status: "started" }),
		ev(2, {
			kind: "tool",
			id: "t1",
			name: "shell",
			output: [
				{
					content: { text: "listed the directory", type: "text" },
					type: "content",
				},
			],
			status: "completed",
		}),
	]);
	const [block] = asAssistant(turns[0]).blocks;
	if (block.kind === "tool") {
		expect(block.tool.result).toBe("listed the directory");
	} else {
		throw new Error("expected a tool block");
	}
});

it("folds a subagent Task call (input has subagent_type) into its own task turn", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "tool",
			id: "call_1",
			input: {
				description: "Explore project structure",
				prompt: "Explore the project at ...",
				subagent_type: "explore",
			},
			name: "Explore project structure",
			status: "started",
		}),
		ev(2, {
			kind: "tool",
			id: "call_1",
			name: "Explore project structure",
			output: [
				{
					content: {
						text: '<task id="ses_1" state="completed">\n<task_result>\nsummary text\n</task_result>\n</task>',
						type: "text",
					},
					type: "content",
				},
			],
			status: "completed",
		}),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["task"]);
	const [task] = turns;
	if (task.kind !== "task") {
		throw new Error("expected a task turn");
	}
	expect(task.task).toMatchObject({
		resultText: "summary text",
		status: "complete",
		title: "Explore project structure",
	});
});

it("keeps a Task call whose input only has description+prompt as a task turn too", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "tool",
			id: "call_1",
			input: { description: "Run tests", prompt: "Run the test suite" },
			name: "Task",
			status: "started",
		}),
		ev(2, {
			kind: "tool",
			id: "call_1",
			name: "Task",
			output: "all tests passed",
			status: "completed",
		}),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["task"]);
	const [task] = turns;
	if (task.kind !== "task") {
		throw new Error("expected a task turn");
	}
	// Claude's Task result is a plain string with no XML wrapper — it passes
	// through unchanged.
	expect(task.task.resultText).toBe("all tests passed");
});

// RC-T3 cancelled-approval-retract fold specs live in
// bridge-turns-retract.test.ts — split out to fit the 300-line file limit.

it("dedupes replayed ids so the assistant text is never doubled", () => {
	const window = [
		{ id: 1, data: { kind: "output", text: "abc" } },
		{ id: 2, data: { kind: "output", text: "def" } },
	];
	let state = feedReducer(initialFeedState, { type: "events", events: window });
	// A reconnect replays the whole window, including ids already delivered.
	state = feedReducer(state, { type: "events", events: window });
	const turns = foldEventsToTurns(state.events);
	expect(turns).toHaveLength(1);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "abcdef" },
	]);
});
