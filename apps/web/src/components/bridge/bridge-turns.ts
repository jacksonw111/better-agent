import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { isTaskToolInput } from "@/genui/tool-renderers";
import {
	accumulateOutput,
	type FoldState,
	finalizeAssistantMessage,
	openAssistant,
} from "./bridge-assistant-merge";
import type {
	MessageEvent,
	NormalizedEvent,
	StatusEvent,
	StreamEvent,
	ToolEvent,
} from "./bridge-events";
import {
	PLAN_STATUS,
	SESSION_LIST_STATUS,
	SESSION_READY_STATUS,
	TURN_USAGE_STATUS,
	USAGE_UPDATE_STATUS,
} from "./bridge-session-status";
import type { BridgeTurn, PlanTurn } from "./bridge-turn-types";
import { stripTaskWrapper, type TaskInvocation } from "./task-card";
import { parseTodoItems } from "./todo-list";
import { flattenToolResult } from "./tool-result-text";

export type {
	AssistantTurn,
	BridgeTurn,
	TaskTurn,
	UserTurn,
} from "./bridge-turn-types";

/** Status events hidden from the chat feed: curated metadata statuses (session
 * capabilities, cost/tokens, past-conversations — surfaced by dedicated header/
 * chip UI) AND pure lifecycle heartbeats (pi's agent_start/turn_start, codex's
 * turn_started, opencode's usage_update) that carry nothing worth reading inline.
 * All still act as a turn boundary (closing any open assistant accumulation). */
const HIDDEN_STATUS_KINDS = new Set<string>([
	SESSION_READY_STATUS,
	TURN_USAGE_STATUS,
	SESSION_LIST_STATUS,
	USAGE_UPDATE_STATUS,
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"turn_started",
	"turn_completed",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"auto_retry_start",
	"auto_retry_end",
]);

/** Folds a `plan` status update into the ONE plan turn: creates it on the first
 * update (at its natural position), then replaces its items in place on later
 * updates so the checklist fills in rather than stacking copies. An empty/
 * unparseable payload is ignored. */
function foldPlan(state: FoldState, id: number, event: StatusEvent): void {
	const items = parseTodoItems(event.detail);
	if (items.length === 0) {
		return;
	}
	if (state.plan) {
		state.plan.items = items;
		return;
	}
	const turn: PlanTurn = { kind: "plan", id, items };
	state.plan = turn;
	state.turns.push(turn);
}

function toolStatusOf(status: ToolEvent["status"]): {
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

function applyToolResult(tool: ToolInvocation, event: ToolEvent): void {
	const { status, isError } = toolStatusOf(event.status);
	tool.status = status;
	tool.isError = isError;
	if (event.output !== undefined) {
		tool.result = flattenToolResult(event.output);
	}
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

function createTaskInvocation(event: ToolEvent): TaskInvocation {
	return {
		callId: event.id,
		resultText: "",
		status: "running",
		title: taskTitle(event),
	};
}

function updateTaskInvocation(task: TaskInvocation, event: ToolEvent): void {
	const { status } = toolStatusOf(event.status);
	task.status = status;
	if (event.output !== undefined) {
		task.resultText = stripTaskWrapper(flattenToolResult(event.output));
	}
}

/** A task call never joins the assistant's block flow — it closes any open
 * assistant accumulation and renders as its own turn, mirroring how a file
 * or status event is folded, so its card can show every status (a plain
 * `ToolGroup` rich-render only ever shows once a call is complete). */
function foldTaskTool(state: FoldState, id: number, event: ToolEvent): void {
	state.current = null;
	const existing = state.tasksByCallId.get(event.id);
	const task = existing ?? createTaskInvocation(event);
	updateTaskInvocation(task, event);
	if (!existing) {
		state.tasksByCallId.set(event.id, task);
		state.turns.push({ kind: "task", id, task });
	}
}

/** A message is a turn boundary: it closes any open output accumulation. A
 * user message always starts its own turn; an assistant message merges by id
 * with its in-flight streamed bubble (or opens a fresh one) — see
 * `finalizeAssistantMessage` in bridge-assistant-merge.ts for the id contract
 * that fixes codex's double-rendered output. */
function foldMessage(state: FoldState, id: number, event: MessageEvent): void {
	if (event.role === "user") {
		state.current = null;
		state.turns.push({ kind: "user", id, text: event.text });
		return;
	}
	finalizeAssistantMessage(state, id, event);
}

function foldTool(state: FoldState, id: number, event: ToolEvent): void {
	// A completed/failed follow-up for an already-started task never carries
	// `input` again, so a call already known to be a task is routed there
	// unconditionally — only a brand-new call needs the input-shape check.
	if (state.tasksByCallId.has(event.id)) {
		foldTaskTool(state, id, event);
		return;
	}
	// A later update (completed/failed) mutates the block created at `started`
	// in place — even if a boundary has since closed that assistant turn — so
	// it never spawns a spurious empty bubble.
	const existing = state.toolsByCallId.get(event.id);
	if (existing) {
		applyToolResult(existing, event);
		return;
	}
	// A subagent "Task" tool: identified by input shape (subagent_type, or
	// description+prompt) OR by claude's fixed tool name "Task" — the name
	// fallback catches calls whose args arrive late, folding into a TaskCard.
	if (event.name === "Task" || isTaskToolInput(event.input)) {
		foldTaskTool(state, id, event);
		return;
	}
	const turn = openAssistant(state, id);
	const tool: ToolInvocation = {
		callId: event.id,
		toolName: event.name,
		args: event.input,
		isError: false,
		status: "running",
	};
	applyToolResult(tool, event);
	turn.blocks.push({ kind: "tool", tool });
	state.toolsByCallId.set(event.id, tool);
}

function foldEvent(state: FoldState, id: number, event: NormalizedEvent): void {
	switch (event.kind) {
		case "message":
			foldMessage(state, id, event);
			return;
		case "output":
			accumulateOutput(state, id, event);
			return;
		case "tool":
			foldTool(state, id, event);
			return;
		case "status":
			state.current = null;
			if (event.status === PLAN_STATUS) {
				foldPlan(state, id, event);
			} else if (!HIDDEN_STATUS_KINDS.has(event.status)) {
				state.turns.push({ kind: "status", id, event });
			}
			return;
		case "error":
			state.current = null;
			state.turns.push({ kind: "error", id, event });
			return;
		case "file":
			state.current = null;
			state.turns.push({ kind: "file", id, event });
			return;
		default:
			state.current = null;
			state.turns.push({ kind: "approval", id, event });
	}
}

/**
 * Folds the ordered, already-deduped bridge feed into renderable turns. Pure
 * and deterministic: only the trailing still-open assistant turn is marked
 * `streaming`, so a completed turn never keeps a caret.
 */
export function foldEventsToTurns(events: StreamEvent[]): BridgeTurn[] {
	const state: FoldState = {
		assistantByMessageId: new Map(),
		current: null,
		plan: null,
		tasksByCallId: new Map(),
		toolsByCallId: new Map(),
		turns: [],
	};
	for (const { id, event } of events) {
		foldEvent(state, id, event);
	}
	if (state.current) {
		state.current.streaming = true;
	}
	return state.turns;
}
