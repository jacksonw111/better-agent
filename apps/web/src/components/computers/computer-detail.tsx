import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ListTodoIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { computerMeta, ToolFacts } from "@/components/computers/computer-facts";
import { ComputerStatusChip } from "@/components/computers/computer-status-chip";
import { EmptyState } from "@/components/layout/empty-state";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { TaskCard } from "@/components/tasks/task-list";
import type { TaskListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS — Connected/Offline stays fresh
 * while the page is open, and run statuses move on their own, so both
 * queries poll at the same cadence as their list pages. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

function TasksSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="h-28 w-full rounded-xl" />
			<Skeleton className="h-28 w-full rounded-xl" />
		</div>
	);
}

/** This computer's tasks — the same card shape as /tasks, filtered
 * client-side from the shared tasks.list query. The meta line drops the
 * computer name (the page IS the computer) and keeps the runtime. */
function ComputerTasks({
	computerId,
	onNewTask,
}: {
	computerId: string;
	onNewTask: () => void;
}) {
	const tasksQuery = useQuery({
		...orpc.tasks.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});

	if (tasksQuery.isPending) {
		return <TasksSkeleton />;
	}

	const tasks = (tasksQuery.data ?? []).filter(
		(task: TaskListItem) => task.computerId === computerId
	);
	if (tasks.length === 0) {
		return (
			<EmptyState
				action={
					<Button onClick={onNewTask} size="sm" type="button" variant="outline">
						<PlusIcon />
						New Task
					</Button>
				}
				body="Start one and the agent works on this machine — it'll show up here with its latest run."
				icon={ListTodoIcon}
				title="No tasks on this computer yet"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{tasks.map((task) => (
				<TaskCard
					key={task.id}
					meta={AGENT_LABELS[task.agentKind]}
					task={task}
				/>
			))}
		</div>
	);
}

function ComputerDetailSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-2">
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-64" />
				</div>
				<Skeleton className="h-8 w-28" />
			</div>
			<TasksSkeleton />
		</div>
	);
}

function NotFound() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This computer wasn't found — it may have been deleted, or the link is
			wrong.
		</p>
	);
}

/**
 * The /computers/$computerId body: the machine's read-only facts (name,
 * Connected/Offline, platform/arch/client version, git/gh) as the header,
 * then THIS computer's tasks as the main content, with a New Task button
 * that opens the wizard with this computer pre-selected (still changeable
 * in Step 1). Agent runtimes are deliberately not listed here — runtime
 * choice lives in the wizard. Reads from the same computers.list and
 * tasks.list queries the list pages use — no extra API.
 */
export function ComputerDetail({ computerId }: { computerId: string }) {
	const query = useQuery({
		...orpc.computers.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	const [newTaskOpen, setNewTaskOpen] = useState(false);

	if (query.isPending) {
		return <ComputerDetailSkeleton />;
	}

	const computer = (query.data ?? []).find((item) => item.id === computerId);
	if (!computer) {
		return <NotFound />;
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<h1 className="truncate font-semibold text-lg">{computer.name}</h1>
						<ComputerStatusChip connected={computer.connected} />
					</div>
					<p className="text-muted-foreground text-sm">
						{computerMeta(computer)}
					</p>
					<ToolFacts tools={computer.toolInventory} />
				</div>
				<Button onClick={() => setNewTaskOpen(true)} size="sm" type="button">
					<PlusIcon />
					New Task
				</Button>
			</div>
			<section className="flex flex-col gap-2">
				<h2 className="font-medium text-sm">Tasks</h2>
				<ComputerTasks
					computerId={computer.id}
					onNewTask={() => setNewTaskOpen(true)}
				/>
			</section>
			<NewTaskDialog
				defaultComputerId={computer.id}
				onOpenChange={setNewTaskOpen}
				open={newTaskOpen}
			/>
		</div>
	);
}
