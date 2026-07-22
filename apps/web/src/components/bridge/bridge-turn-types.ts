import type {
	ChatBlock,
	ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";
import type { ErrorEvent, FileEvent, StatusEvent } from "./bridge-events";
import type { TaskInvocation } from "./task-invocation";
import type { TodoItem } from "./todo-list";

/**
 * One coherent turn folded out of the granular bridge event stream, ready to
 * render with the same components the normal chat uses. `message`/`output`/
 * `tool` events collapse into `user`/`assistant` bubbles; approval/question
 * requests fold INTO the assistant turn as `approval`/`question` blocks (same
 * as tool calls) so they share the message's avatar and spine instead of
 * breaking the line. The remaining kinds pass through as their own inline rows
 * (a subtle status line, an error line, a file line, a task card, a todolist).
 */
export interface AssistantTurn {
	blocks: ChatBlock[];
	id: number;
	kind: "assistant";
	/** Set only on the trailing still-open turn, so the streaming markdown
	 * caret shows while output is arriving and stops at the next boundary. */
	streaming: boolean;
}

export interface UserTurn {
	id: number;
	kind: "user";
	/** S3-T2: mirrors `MessageEvent.origin` — a CLI-injected Task Start Context
	 * turn, rendered collapsed (one expandable line) instead of as a bubble. */
	origin?: "task-start";
	/** fix-send-outbox: mirrors `MessageEvent.sendKey`/`sendStatus` — present
	 * only on an optimistic echo still tracked by the send outbox, so the row
	 * can render "sending"/"failed" (with retry/discard) instead of letting an
	 * undelivered message pass for a sent one. */
	sendKey?: string;
	sendStatus?: "failed" | "sending" | "sent";
	text: string;
}

export interface StatusTurn {
	event: StatusEvent;
	id: number;
	kind: "status";
}

export interface ErrorTurn {
	event: ErrorEvent;
	id: number;
	kind: "error";
}

export interface FileTurn {
	event: FileEvent;
	id: number;
	kind: "file";
}

/** A subagent "Task" tool call, folded out of the ordinary tool-block flow
 * into its own turn (like status/error/file lines) so it renders as a task
 * card instead of a generic tool row — see `isTaskToolInput`. */
export interface TaskTurn {
	id: number;
	kind: "task";
	task: TaskInvocation;
}

/** The agent's evolving plan/todo list (opencode's `plan` update). A single
 * turn whose `items` are replaced in place as later plan updates arrive, so it
 * reads as one checklist that fills in — not a new list per update. */
export interface PlanTurn {
	id: number;
	items: TodoItem[];
	kind: "plan";
}

/** fix-tasktool-render: one Claude Code task-list tool call (`TaskCreate`/
 * `TaskUpdate`/`TaskList`), folded out of the ordinary tool-block flow into
 * its own turn so it renders as a clean task card (`TaskToolCard`) instead of
 * the generic one-line tool block — see `foldTaskListTool`. */
export interface TaskToolTurn {
	id: number;
	kind: "task-tool";
	tool: ToolInvocation;
}

export type BridgeTurn =
	| AssistantTurn
	| UserTurn
	| StatusTurn
	| ErrorTurn
	| FileTurn
	| TaskTurn
	| TaskToolTurn
	| PlanTurn;
