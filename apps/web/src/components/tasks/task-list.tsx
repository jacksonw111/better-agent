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
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { EmptyState } from "@/components/layout/empty-state";
import type { TaskListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";
import { RunStatusChip } from "./task-status-chip";

/** Matches the computers list's poll: run statuses move on their own, so the
 * list refreshes itself instead of waiting for a manual reload. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

function NewTaskButton() {
	return (
		<Button render={<Link to="/tasks/new" />} size="sm">
			<PlusIcon />
			New Task
		</Button>
	);
}

function taskMeta(task: TaskListItem, computerName: string | undefined) {
	return `${computerName ?? "Unknown computer"} · ${AGENT_LABELS[task.agentKind]}`;
}

function TaskCard({
	computerName,
	task,
}: {
	computerName: string | undefined;
	task: TaskListItem;
}) {
	return (
		<Link className="block" params={{ taskId: task.id }} to="/tasks/$taskId">
			<Card className="transition-colors hover:bg-accent/40">
				<CardHeader>
					<CardTitle className="truncate">{task.name}</CardTitle>
					<CardDescription>{taskMeta(task, computerName)}</CardDescription>
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

/**
 * The /tasks list: every task with its computer, runtime, latest-run status
 * chip and age, each card linking into the task conversation. Computer names
 * come from a second query joined client-side — the tasks response carries
 * only the id.
 */
export function TaskList() {
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
				action={<NewTaskButton />}
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
				<NewTaskButton />
			</div>
			<div className="flex flex-col gap-3">
				{tasks.map((task) => (
					<TaskCard
						computerName={computerNames.get(task.computerId)}
						key={task.id}
						task={task}
					/>
				))}
			</div>
		</div>
	);
}
