import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ListTodoIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { EmptyState } from "@/components/layout/empty-state";
import type { TaskListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";
import { NewTaskDialog } from "./new-task-dialog";
import { RunStatusChip } from "./task-status-chip";

/** Matches the computers list's poll: run statuses move on their own, so the
 * list refreshes itself instead of waiting for a manual reload. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

function NewTaskButton({ onOpen }: { onOpen: () => void }) {
	return (
		<Button onClick={onOpen} size="sm" type="button">
			<PlusIcon />
			New Task
		</Button>
	);
}

function taskMeta(task: TaskListItem, computerName: string | undefined) {
	return `${computerName ?? "Unknown computer"} · ${AGENT_LABELS[task.agentKind]}`;
}

/** One task card — name, context line, latest-run status chip, age — linking
 * into the conversation. Shared by /tasks (meta: "computer · runtime") and
 * the computer detail page (meta: runtime only; the computer is the page). */
export function TaskCard({ meta, task }: { meta: string; task: TaskListItem }) {
	return (
		<Link className="block" params={{ taskId: task.id }} to="/tasks/$taskId">
			<Card className="transition-colors hover:bg-accent/40">
				<CardHeader>
					<CardTitle className="truncate">{task.name}</CardTitle>
					<CardDescription>{meta}</CardDescription>
					<CardAction>
						<RunStatusChip status={task.latestRun?.status ?? null} />
					</CardAction>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-xs">
						Created {relativeTime(new Date(task.createdAt).toISOString())}
					</p>
				</CardContent>
			</Card>
		</Link>
	);
}

function TasksSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">
				<Skeleton className="h-8 w-28" />
			</div>
			<Skeleton className="h-28 w-full rounded-xl" />
			<Skeleton className="h-28 w-full rounded-xl" />
		</div>
	);
}

/** The list itself — empty state and cards; both New Task buttons open the
 * wizard modal owned by TaskList. */
function TaskListContent({ onNewTask }: { onNewTask: () => void }) {
	const tasksQuery = useQuery({
		...orpc.tasks.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	const computersQuery = useQuery(orpc.computers.list.queryOptions());

	if (tasksQuery.isPending) {
		return <TasksSkeleton />;
	}

	const tasks = tasksQuery.data ?? [];
	if (tasks.length === 0) {
		return (
			<EmptyState
				action={<NewTaskButton onOpen={onNewTask} />}
				body="A task pairs your request with a computer and an agent runtime — start one and the agent works on your own machine."
				icon={ListTodoIcon}
				title="No tasks yet"
			/>
		);
	}

	const computerNames = new Map<string, string>(
		(computersQuery.data ?? []).map((computer) => [computer.id, computer.name])
	);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">
				<NewTaskButton onOpen={onNewTask} />
			</div>
			<div className="flex flex-col gap-3">
				{tasks.map((task) => (
					<TaskCard
						key={task.id}
						meta={taskMeta(task, computerNames.get(task.computerId))}
						task={task}
					/>
				))}
			</div>
		</div>
	);
}

/**
 * The /tasks list: every task with its computer, runtime, latest-run status
 * chip and age, each card linking into the task conversation. Computer names
 * come from a second query joined client-side — the tasks response carries
 * only the id. New Task opens the wizard as a modal (spec: New Task modal);
 * `initialNewTaskOpen` backs the /tasks?new=1 deep link and
 * `onNewTaskOpenChange` lets the route drop that param once the modal closes.
 */
export function TaskList({
	initialNewTaskOpen = false,
	onNewTaskOpenChange,
}: {
	initialNewTaskOpen?: boolean;
	onNewTaskOpenChange?: (open: boolean) => void;
}) {
	const [newTaskOpen, setNewTaskOpen] = useState(initialNewTaskOpen);
	const changeNewTaskOpen = (next: boolean) => {
		setNewTaskOpen(next);
		onNewTaskOpenChange?.(next);
	};
	return (
		<>
			<TaskListContent onNewTask={() => changeNewTaskOpen(true)} />
			<NewTaskDialog onOpenChange={changeNewTaskOpen} open={newTaskOpen} />
		</>
	);
}
