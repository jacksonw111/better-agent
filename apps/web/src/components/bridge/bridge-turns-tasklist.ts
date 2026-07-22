import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { FoldState } from "./bridge-assistant-merge";
import { pushTurn } from "./bridge-assistant-merge";
import type { ToolEvent } from "./bridge-events";
import type { TaskToolTurn } from "./bridge-turn-types";
import { toolStatusOf } from "./bridge-turns-tool-task";

// fix-tasktool-render: routes Claude Code's built-in task-list tools
// (`TaskCreate`/`TaskUpdate`/`TaskList`) out of the ordinary tool-block flow
// into their own turn — like the subagent Task card and the plan/todo list —
// so they render as clean task cards (task-tool-card.tsx) instead of the
// generic one-line tool block. Kept in its own file so bridge-turns.ts stays
// under the repo's file-size budget.

const TASK_LIST_TOOL_NAMES = new Set(["TaskCreate", "TaskUpdate", "TaskList"]);

/** True for a Claude Code task-list tool call by its fixed tool name. */
export function isTaskListTool(name: string): boolean {
	return TASK_LIST_TOOL_NAMES.has(name);
}

/** Unlike `applyToolResult`, keeps the RAW output on `tool.result` (not
 * flattened to text): `TaskList`'s card needs the structured array, and the
 * `TaskCreate`/`TaskUpdate` cards flatten it themselves only when they need
 * text. */
function applyRawResult(tool: ToolInvocation, event: ToolEvent): void {
	const { status, isError } = toolStatusOf(event.status);
	tool.status = status;
	tool.isError = isError;
	if (event.output !== undefined) {
		tool.result = event.output;
	}
	if (event.durationMs !== undefined) {
		tool.durationMs = event.durationMs;
	}
}

/** Folds a task-list tool event into its own turn (creating it on the first
 * event, mutating it in place on the settle). Closes any open assistant
 * accumulation, mirroring how the subagent Task and plan turns fold. */
export function foldTaskListTool(
	state: FoldState,
	id: number,
	event: ToolEvent
): void {
	state.current = null;
	const existing = state.taskToolsByCallId.get(event.id);
	if (existing) {
		applyRawResult(existing.turn.tool, event);
		state.touched.add(existing.turn);
		return;
	}
	const tool: ToolInvocation = {
		args: event.input,
		callId: event.id,
		isError: false,
		status: "running",
		toolName: event.name,
	};
	applyRawResult(tool, event);
	const turn: TaskToolTurn = { id, kind: "task-tool", tool };
	state.taskToolsByCallId.set(event.id, { turn });
	pushTurn(state, turn);
}
