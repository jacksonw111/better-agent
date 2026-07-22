import { cn } from "@better-agent/ui/lib/utils";
import {
	CheckCircle2Icon,
	CircleDashedIcon,
	CircleDotIcon,
} from "lucide-react";

type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	content: string;
	status: TodoStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function toStatus(value: unknown): TodoStatus {
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

/** Parses an agent's plan/todo payload (opencode ACP `plan` entries, or a
 * TodoWrite tool's `todos`) into checklist items, tolerant of the field names
 * different agents use (`content`/`text`/`title`, `status` variants). */
export function parseTodoItems(detail: unknown): TodoItem[] {
	if (!Array.isArray(detail)) {
		return [];
	}
	const items: TodoItem[] = [];
	for (const raw of detail) {
		if (!isRecord(raw)) {
			continue;
		}
		const content =
			asString(raw.content) ??
			asString(raw.text) ??
			asString(raw.title) ??
			asString(raw.subject) ??
			asString(raw.name);
		if (content) {
			items.push({ content, status: toStatus(raw.status) });
		}
	}
	return items;
}

const STATUS_ICON = {
	completed: <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />,
	in_progress: (
		<CircleDotIcon className="size-4 shrink-0 animate-pulse text-primary" />
	),
	pending: (
		<CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
	),
} as const;

function TodoRow({ item }: { item: TodoItem }) {
	return (
		<li className="flex items-start gap-2 py-1">
			{STATUS_ICON[item.status]}
			<span
				className={cn(
					"text-sm leading-5",
					item.status === "completed" && "text-muted-foreground line-through",
					item.status === "in_progress" && "font-medium"
				)}
			>
				{item.content}
			</span>
		</li>
	);
}

/** Renders an agent's plan/todo list as a checklist — the opencode `plan`
 * update (and any TodoWrite-style tool) is a task list, not a plain status
 * line. Shows a done/total count so progress reads at a glance. */
export function TodoList({ items }: { items: TodoItem[] }) {
	if (items.length === 0) {
		return null;
	}
	const done = items.filter((item) => item.status === "completed").length;
	return (
		<div className="my-1 w-full max-w-xl rounded-lg bg-muted/40 px-3 py-2">
			<div className="mb-1 flex items-center justify-between">
				<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Plan
				</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{done}/{items.length}
				</span>
			</div>
			<ul className="flex flex-col">
				{items.map((item) => (
					<TodoRow item={item} key={item.content} />
				))}
			</ul>
		</div>
	);
}
