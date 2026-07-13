import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { FoldState } from "./bridge-assistant-merge";
import type { ToolEvent } from "./bridge-events";
import type { TaskTurn } from "./bridge-turn-types";
import {
	stripTaskWrapper,
	type TaskInvocation,
	type TaskToolRun,
} from "./task-invocation";
import { flattenToolResult } from "./tool-result-text";

// Tool/task status + text-shaping helpers used by `foldTool`/`foldTaskTool`
// in bridge-turns.ts — split into their own file purely to keep that file
// under the repo's 300-line limit (R0-T4's incremental-fold plumbing needed
// the room). P1-T3 added the subagent tool-history accumulation below.

export function toolStatusOf(status: ToolEvent["status"]): {
	isError: boolean;
	status: ToolInvocation["status"];
} {
	if (status === "completed") {
		return { status: "complete", isError: false };
	}
	if (status === "failed") {
		return { status: "error", isError: true };
	}
	return { status: "running", isError: false };
}

/** Copies R1-T2's additive wire fields onto the block's `ToolInvocation`.
 * Each is set only when present on THIS event: `title`/`durationMs` usually
 * land once (on `started`/`completed` respectively) and must survive later
 * updates that don't repeat them; `preview` is replace-semantics per event
 * (a running call's latest partial output), so a later event without one
 * simply leaves the prior value in place rather than clearing it. */
function applyToolMeta(tool: ToolInvocation, event: ToolEvent): void {
	if (event.title !== undefined) {
		tool.title = event.title;
	}
	if (event.durationMs !== undefined) {
		tool.durationMs = event.durationMs;
	}
	if (event.preview !== undefined) {
		tool.preview = event.preview;
	}
}

export function applyToolResult(tool: ToolInvocation, event: ToolEvent): void {
	const { status, isError } = toolStatusOf(event.status);
	tool.status = status;
	tool.isError = isError;
	if (event.output !== undefined) {
		tool.result = flattenToolResult(event.output);
	}
	applyToolMeta(tool, event);
}

/** A task's title is its `description` input when present (opencode names
 * the call after it already, but Claude's fixed-name "Task" tool doesn't),
 * falling back to the raw tool name otherwise. */
function taskTitle(event: ToolEvent): string {
	const input = event.input as { description?: unknown } | null | undefined;
	if (input && typeof input.description === "string" && input.description) {
		return input.description;
	}
	return event.name;
}

/** A string field of the task's input, when present ("prompt",
 * "subagent_type") — only ever on the `started` event. */
function taskInputString(event: ToolEvent, key: string): string | undefined {
	const input = event.input;
	if (typeof input !== "object" || input === null) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const value = (input as Record<string, unknown>)[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

export function createTaskInvocation(event: ToolEvent): TaskInvocation {
	return {
		callId: event.id,
		prompt: taskInputString(event, "prompt"),
		resultText: "",
		status: "running",
		subagentType: taskInputString(event, "subagent_type"),
		title: taskTitle(event),
		toolRuns: [],
	};
}

/** A settled task can't still be running a tool: any run left `running`
 * (its `completed` event never arrived — interrupt, or the task failed mid-
 * call) inherits the task's terminal status so the history never shows a
 * stuck spinner. */
function settleToolRuns(task: TaskInvocation): void {
	const settled = task.status === "error" ? "error" : "complete";
	for (const run of task.toolRuns ?? []) {
		if (run.status === "running") {
			run.status = settled;
		}
	}
}

export function updateTaskInvocation(
	task: TaskInvocation,
	event: ToolEvent
): void {
	const { status } = toolStatusOf(event.status);
	task.status = status;
	if (event.output !== undefined) {
		task.resultText = stripTaskWrapper(flattenToolResult(event.output));
	}
	if (event.durationMs !== undefined) {
		task.durationMs = event.durationMs;
	}
	if (status !== "running") {
		settleToolRuns(task);
	}
}

/** Records one nested tool event into `task.toolRuns`. A new run is only
 * ever created from a `started` event (a bare `completed` carries no real
 * name — claude's tool_result normalization reuses the call id — and a
 * settle for a call the task never started likely belongs to the main
 * thread); later updates mutate the run's status in place. Returns whether
 * anything changed, so the caller only marks the turn touched when it did. */
function recordTaskToolRun(task: TaskInvocation, event: ToolEvent): boolean {
	const { status } = toolStatusOf(event.status);
	if (task.toolRuns === undefined) {
		task.toolRuns = [];
	}
	const runs = task.toolRuns;
	const existing = runs.find((run) => run.callId === event.id);
	if (existing) {
		existing.status = status;
		return true;
	}
	if (event.status !== "started") {
		return false;
	}
	const run: TaskToolRun = { callId: event.id, name: event.name, status };
	runs.push(run);
	return true;
}

/** P1-T3: attributes a plain (non-task) tool event to the subagent that is
 * presumably executing it. The wire carries NO parent linkage — claude's
 * `parent_tool_use_id` is dropped by the CLI normalizer (see
 * apps/bridge-cli/src/normalize/claude-code.ts), and opencode's subagents
 * run in child sessions the feed never sees — so attribution is heuristic:
 * while EXACTLY ONE task is running, every tool event belongs to it
 * (claude's foreground Task blocks the main loop). Zero or 2+ running tasks
 * is ambiguous → no attribution. ADDITIVE-ONLY: the tool still folds into
 * the feed as its own block exactly as before; the task card just mirrors
 * its name+status in its history list. */
export function recordSubagentActivity(
	state: FoldState,
	event: ToolEvent
): void {
	let sole: TaskTurn | null = null;
	for (const turn of state.tasksByCallId.values()) {
		if (turn.task.status !== "running") {
			continue;
		}
		if (sole) {
			return;
		}
		sole = turn;
	}
	if (sole && recordTaskToolRun(sole.task, event)) {
		state.touched.add(sole);
	}
}
