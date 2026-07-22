import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import type { TaskToolTurn } from "./bridge-turn-types";
import { foldEventsToTurns } from "./bridge-turns";

// Not grouped under a `describe` — the repo's max-lines-per-function gate
// counts a wrapping describe callback's body too (see bridge-turns.test.ts).

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

const asTaskTool = (turn: unknown): TaskToolTurn => {
	const t = turn as { kind?: string };
	if (t.kind !== "task-tool") {
		throw new Error(`expected a task-tool turn, got ${t.kind}`);
	}
	return turn as TaskToolTurn;
};

it("folds a TaskCreate call into its own task-tool turn (not a tool block)", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "tool",
			id: "tc1",
			name: "TaskCreate",
			input: { subject: "Build the thing" },
			status: "started",
		}),
		ev(2, {
			kind: "tool",
			id: "tc1",
			name: "TaskCreate",
			status: "completed",
			output: "Task #9 created successfully: Build the thing",
		}),
	]);
	expect(turns).toHaveLength(1);
	const turn = asTaskTool(turns[0]);
	expect(turn.tool.toolName).toBe("TaskCreate");
	expect(turn.tool.status).toBe("complete");
	// Raw output is preserved (not flattened away) for the card to parse.
	expect(turn.tool.result).toBe(
		"Task #9 created successfully: Build the thing"
	);
});

it("keeps the structured TaskList output as a raw array", () => {
	const list = [
		{ taskId: "1", subject: "A", status: "completed" },
		{ taskId: "2", subject: "B", status: "in_progress" },
	];
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "tool",
			id: "tl1",
			name: "TaskList",
			status: "completed",
			output: list,
		}),
	]);
	const turn = asTaskTool(turns[0]);
	expect(turn.tool.result).toEqual(list);
});

it("routes TaskUpdate too, and closes any open assistant bubble", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "working on it" }),
		ev(2, {
			kind: "tool",
			id: "tu1",
			name: "TaskUpdate",
			input: { taskId: "9", status: "completed" },
			status: "completed",
			output: "Task #9 updated",
		}),
	]);
	expect(turns).toHaveLength(2);
	expect(turns[0].kind).toBe("assistant");
	expect(asTaskTool(turns[1]).tool.toolName).toBe("TaskUpdate");
});

it("does not treat an ordinary tool call as a task-list tool", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "tool",
			id: "s1",
			name: "shell",
			input: { cmd: "ls" },
			status: "completed",
			output: "file.txt",
		}),
	]);
	// An ordinary tool still folds into an assistant bubble as a tool block.
	expect(turns[0].kind).toBe("assistant");
});
