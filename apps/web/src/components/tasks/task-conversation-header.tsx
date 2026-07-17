import { Button } from "@better-agent/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, TriangleAlertIcon } from "lucide-react";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import type { TaskDetail, TaskRun } from "@/utils/api-types";
import { RunStatusChip } from "./task-status-chip";

// S3-T2 (master spec §17.3/§11.3): the Conversation's first-screen strip —
// which task, on which computer/runtime, the CURRENT run's status — plus the
// failed run's REAL error and its Retry. All of it lives here, above and
// outside the message history: run lifecycle is state, not chat. Run
// SWITCHING moved out to the left run sidebar (task-run-sidebar.tsx), and the
// workspace strip is gone — path context lives with the Files/Shell/Git
// panes' empty states instead.

/** The failed run's actionable error, OUTSIDE the chat (§11.3). Retry only
 * offers itself on the LATEST run — the server would reject retrying past a
 * newer attempt anyway. */
function FailedRunBanner({
	isLatest,
	onRetry,
	retryPending,
	run,
}: {
	isLatest: boolean;
	onRetry: () => void;
	retryPending: boolean;
	run: TaskRun;
}) {
	return (
		<div
			className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3"
			role="alert"
		>
			<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
			<div className="min-w-0 flex-1">
				<p className="font-medium text-destructive text-sm">Run failed</p>
				<p className="break-words text-muted-foreground text-sm">
					{run.errorMessage ?? "The run failed without a reported error."}
				</p>
			</div>
			{isLatest && (
				<Button
					disabled={retryPending}
					onClick={onRetry}
					size="sm"
					variant="outline"
				>
					Retry
				</Button>
			)}
		</div>
	);
}

/** Back link + task name + computer · runtime — the "which task is this"
 * cluster (§17.3), split out for the max-lines-per-function gate. */
function TaskIdentity({
	computerName,
	task,
}: {
	computerName: string | null;
	task: TaskDetail["task"];
}) {
	return (
		<>
			<Link
				aria-label="Back to tasks"
				className="text-muted-foreground transition-colors hover:text-foreground"
				to="/tasks"
			>
				<ArrowLeftIcon className="size-4" />
			</Link>
			<h1 className="min-w-0 truncate font-semibold text-base">{task.name}</h1>
			<span className="text-muted-foreground text-xs">
				{computerName ?? "Unknown computer"} · {AGENT_LABELS[task.agentKind]}
			</span>
		</>
	);
}

/** The lightweight header strip above the workspace pane: back link, task
 * name, computer · runtime, and the current run's status chip. */
export function TaskConversationHeader({
	computerName,
	currentRun,
	onRetry,
	retryPending,
	runs,
	task,
}: {
	computerName: string | null;
	currentRun: TaskRun | null;
	onRetry: () => void;
	retryPending: boolean;
	runs: TaskRun[];
	task: TaskDetail["task"];
}) {
	const isLatest = currentRun !== null && currentRun.id === runs.at(-1)?.id;
	return (
		<div className="flex shrink-0 flex-col gap-2 px-3 pt-3 sm:px-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<TaskIdentity computerName={computerName} task={task} />
				<div className="ml-auto flex items-center gap-2">
					<RunStatusChip status={currentRun?.status ?? null} />
				</div>
			</div>
			{currentRun?.status === "failed" && (
				<FailedRunBanner
					isLatest={isLatest}
					onRetry={onRetry}
					retryPending={retryPending}
					run={currentRun}
				/>
			)}
		</div>
	);
}
