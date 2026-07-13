import { expect, it } from "vitest";
import type { StreamEvent, ToolEvent } from "./bridge-events";
import type { TaskTurn } from "./bridge-turn-types";
import { foldEventsToTurns } from "./bridge-turns";

// P1-T3: the heuristic subagent tool-history accumulation — while EXACTLY
// one task is running, plain tool events are mirrored into its `toolRuns`
// (see recordSubagentActivity in bridge-turns-tool-task.ts). Not grouped
// under a `describe` — the repo's max-lines-per-function gate counts a
// wrapping describe callback's body too.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

const taskStart = (id: string): ToolEvent => ({
	kind: "tool",
	id,
	name: "Task",
	input: {
		description: "Explore the repo",
		prompt: "Find every TODO",
		subagent_type: "explore",
	},
	status: "started",
});

const taskEnd = (id: string, status: "completed" | "failed"): ToolEvent => ({
	kind: "tool",
	id,
	name: "Task",
	output: "summary",
	status,
});

function soleTask(turns: ReturnType<typeof foldEventsToTurns>): TaskTurn {
	const found = turns.find((turn) => turn.kind === "task");
	if (found?.kind !== "task") {
		throw new Error("expected a task turn");
	}
	return found;
}

it("mirrors a nested tool's start and settle into the sole running task's history", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, { kind: "tool", id: "t2", name: "Read", status: "started" }),
		ev(3, { kind: "tool", id: "t2", name: "t2", status: "completed" }),
		ev(4, taskEnd("task_1", "completed")),
	]);
	expect(soleTask(turns).task.toolRuns).toEqual([
		{ callId: "t2", name: "Read", status: "complete" },
	]);
});

it("keeps the attribution ADDITIVE: the nested tool still folds as its own block too", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, { kind: "tool", id: "t2", name: "Read", status: "started" }),
	]);
	expect(turns.map((turn) => turn.kind)).toEqual(["task", "assistant"]);
});

it("tracks a still-running nested tool for the Currently indicator", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, { kind: "tool", id: "t2", name: "Grep", status: "started" }),
	]);
	expect(soleTask(turns).task.toolRuns).toEqual([
		{ callId: "t2", name: "Grep", status: "running" },
	]);
});

it("captures the prompt and subagent_type from the task's input", () => {
	const turns = foldEventsToTurns([ev(1, taskStart("task_1"))]);
	expect(soleTask(turns).task).toMatchObject({
		prompt: "Find every TODO",
		subagentType: "explore",
	});
});

it("captures the task's durationMs when the settle event carries one", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, { ...taskEnd("task_1", "completed"), durationMs: 5300 }),
	]);
	expect(soleTask(turns).task.durationMs).toBe(5300);
});

it("attributes nothing while TWO tasks are running (ambiguous)", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, taskStart("task_2")),
		ev(3, { kind: "tool", id: "t3", name: "Read", status: "started" }),
	]);
	const tasks = turns.filter((turn) => turn.kind === "task");
	expect(tasks).toHaveLength(2);
	for (const turn of tasks) {
		if (turn.kind === "task") {
			expect(turn.task.toolRuns).toEqual([]);
		}
	}
});

it("never records a second task's start as a tool run of the first", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, taskStart("task_2")),
	]);
	const tasks = turns.filter((turn) => turn.kind === "task");
	expect(tasks).toHaveLength(2);
	if (tasks[0].kind === "task") {
		expect(tasks[0].task.toolRuns).toEqual([]);
	}
});

it("ignores the settle of a tool that started BEFORE the task did", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "tool", id: "t0", name: "Bash", status: "started" }),
		ev(2, taskStart("task_1")),
		ev(3, { kind: "tool", id: "t0", name: "t0", status: "completed" }),
	]);
	expect(soleTask(turns).task.toolRuns).toEqual([]);
});

it("settles a dangling running run when the task completes", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, { kind: "tool", id: "t2", name: "Read", status: "started" }),
		ev(3, taskEnd("task_1", "completed")),
	]);
	expect(soleTask(turns).task.toolRuns).toEqual([
		{ callId: "t2", name: "Read", status: "complete" },
	]);
});

it("settles a dangling running run as errored when the task fails", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, { kind: "tool", id: "t2", name: "Read", status: "started" }),
		ev(3, taskEnd("task_1", "failed")),
	]);
	expect(soleTask(turns).task.toolRuns).toEqual([
		{ callId: "t2", name: "Read", status: "error" },
	]);
});

it("stops attributing once the task has settled", () => {
	const turns = foldEventsToTurns([
		ev(1, taskStart("task_1")),
		ev(2, taskEnd("task_1", "completed")),
		ev(3, { kind: "tool", id: "t3", name: "Read", status: "started" }),
	]);
	expect(soleTask(turns).task.toolRuns).toEqual([]);
});
