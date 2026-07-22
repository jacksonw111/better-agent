import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import {
	CheckCircle2Icon,
	CircleDashedIcon,
	CircleDotIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { renderActivityTool } from "./bridge-tool-card";
import { parseTodoItems, type TodoItem } from "./todo-list";
import { flattenToolResult } from "./tool-result-text";

// fix-tasktool-render: Claude Code's built-in task-list tools (`TaskCreate`/
// `TaskUpdate`/`TaskList`) have no rich renderer, so they fell through to the
// generic tool block — an ugly one-liner ("TaskCreate 0.0s Task #9 created
// successfully: …"). This card renders them like the `TodoWrite`/plan
// checklist (todo-list.tsx): a clean, tinted, borderless task row with the
// same status icon/color semantics.
//
// DATA-SHAPE ASSUMPTIONS (no fixtures exist in-repo — Claude Code's tools are
// not normalized by the bridge-cli the way TodoWrite is, so they arrive as
// raw `tool` events). Verified against the reported real output string; the
// rest is inferred from the tools' semantics and kept tolerant:
//   TaskCreate  input  { subject, description?, activeForm? }
//               output "Task #<n> created successfully: <subject>"
//   TaskUpdate  input  { taskId, status?, subject?, description? }
//               output "Task #<n> updated"
//   TaskList    output a structured array of { taskId/id, subject, status }
//               (or { tasks: [...] }), else a plain text listing.
// Every field is read defensively; a call whose shape yields nothing to show
// degrades to the generic tool card rather than crashing or rendering blank.

type TaskStatus = TodoItem["status"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function toStatus(value: unknown): TaskStatus {
	if (value === "completed" || value === "done" || value === "complete") {
		return "completed";
	}
	if (
		value === "in_progress" ||
		value === "in-progress" ||
		value === "active"
	) {
		return "in_progress";
	}
	return "pending";
}

const STATUS_LABEL: Record<TaskStatus, string> = {
	completed: "Completed",
	in_progress: "In progress",
	pending: "To do",
};

function StatusIcon({ status }: { status: TaskStatus }) {
	if (status === "completed") {
		return <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />;
	}
	if (status === "in_progress") {
		return (
			<CircleDotIcon className="size-4 shrink-0 animate-pulse text-primary" />
		);
	}
	return <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />;
}

/** The shared tinted, borderless shell — same visual language as `TodoList`. */
function CardShell({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<div className="my-1 w-full max-w-xl rounded-lg bg-muted/40 px-3 py-2">
			<div className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</div>
			{children}
		</div>
	);
}

const CREATED_SUBJECT_RE = /created successfully:\s*(.+)\s*$/i;

/** The task's human title: prefers the structured input field, then the
 * subject echoed back in a "created successfully: <subject>" output line. */
function subjectOf(input: unknown, resultText: string): string | undefined {
	if (isRecord(input)) {
		const fromInput =
			asString(input.subject) ??
			asString(input.title) ??
			asString(input.content);
		if (fromInput) {
			return fromInput;
		}
	}
	const match = CREATED_SUBJECT_RE.exec(resultText);
	return match ? match[1].trim() : undefined;
}

function TaskCreateCard({ tool }: { tool: ToolInvocation }) {
	const resultText = flattenToolResult(tool.result);
	const subject = subjectOf(tool.args, resultText);
	if (!subject) {
		return renderActivityTool(tool);
	}
	const description = isRecord(tool.args)
		? asString(tool.args.description)
		: undefined;
	return (
		<CardShell label="New task">
			<div className="flex items-start gap-2">
				<StatusIcon status="pending" />
				<div className="flex flex-col gap-0.5">
					<span className="text-sm leading-5">{subject}</span>
					{description ? (
						<span className="text-muted-foreground text-xs leading-5">
							{description}
						</span>
					) : null}
				</div>
			</div>
		</CardShell>
	);
}

/** The status + subject an update touches, read defensively from its input. */
function parseUpdate(input: unknown): {
	status: TaskStatus | undefined;
	subject: string | undefined;
} {
	const record = isRecord(input) ? input : undefined;
	const status =
		record?.status === undefined ? undefined : toStatus(record.status);
	const taskId = record ? asString(record.taskId) : undefined;
	const subject =
		(record ? asString(record.subject) : undefined) ??
		(taskId ? `Task #${taskId}` : undefined);
	return { status, subject };
}

function TaskUpdateCard({ tool }: { tool: ToolInvocation }) {
	const { status, subject } = parseUpdate(tool.args);
	if (!(status || subject)) {
		return renderActivityTool(tool);
	}
	return (
		<CardShell label="Task update">
			<div className="flex items-center gap-2">
				<StatusIcon status={status ?? "pending"} />
				<span className="text-sm leading-5">{subject ?? "Task"}</span>
				{status ? (
					<span className="text-muted-foreground text-xs">
						→ {STATUS_LABEL[status]}
					</span>
				) : null}
			</div>
		</CardShell>
	);
}

/** Pull the structured task array out of a `TaskList` output, whether it is a
 * bare array or wrapped in `{ tasks: [...] }`. */
function taskArrayOf(result: unknown): unknown[] {
	if (Array.isArray(result)) {
		return result;
	}
	if (isRecord(result) && Array.isArray(result.tasks)) {
		return result.tasks;
	}
	return [];
}

function TaskListRow({ item }: { item: TodoItem }) {
	return (
		<li className="flex items-start gap-2 py-1">
			<StatusIcon status={item.status} />
			<span className="text-sm leading-5">{item.content}</span>
		</li>
	);
}

function TaskListCard({ tool }: { tool: ToolInvocation }) {
	const items = parseTodoItems(taskArrayOf(tool.result));
	if (items.length > 0) {
		return (
			<CardShell label="Tasks">
				<ul className="flex flex-col">
					{items.map((item) => (
						<TaskListRow item={item} key={item.content} />
					))}
				</ul>
			</CardShell>
		);
	}
	const text = flattenToolResult(tool.result).trim();
	if (text) {
		return (
			<CardShell label="Tasks">
				<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-muted-foreground text-xs leading-relaxed">
					{text}
				</pre>
			</CardShell>
		);
	}
	return renderActivityTool(tool);
}

/** Renders a Claude Code task-list tool call (`TaskCreate`/`TaskUpdate`/
 * `TaskList`) as a clean task card. An unrecognized name — or a call whose
 * shape yields nothing to show — degrades to the generic tool card. */
export function TaskToolCard({ tool }: { tool: ToolInvocation }) {
	if (tool.toolName === "TaskCreate") {
		return <TaskCreateCard tool={tool} />;
	}
	if (tool.toolName === "TaskUpdate") {
		return <TaskUpdateCard tool={tool} />;
	}
	if (tool.toolName === "TaskList") {
		return <TaskListCard tool={tool} />;
	}
	return renderActivityTool(tool);
}
