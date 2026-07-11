import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { ToolEvent } from "./bridge-events";
import { stripTaskWrapper, type TaskInvocation } from "./task-card";
import { flattenToolResult } from "./tool-result-text";

// Tool/task status + text-shaping helpers used by `foldTool`/`foldTaskTool`
// in bridge-turns.ts — split into their own file purely to keep that file
// under the repo's 300-line limit (R0-T4's incremental-fold plumbing needed
// the room).

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

export function createTaskInvocation(event: ToolEvent): TaskInvocation {
	return {
		callId: event.id,
		resultText: "",
		status: "running",
		title: taskTitle(event),
	};
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
}
