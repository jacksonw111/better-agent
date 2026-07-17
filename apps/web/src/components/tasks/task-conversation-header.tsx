import { Button } from "@better-agent/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import type { TaskDetail, TaskRun } from "@/utils/api-types";
import { RunStatusChip } from "./task-status-chip";

// P3: the session chat's first-screen strip — which session, on which
// computer/runtime, the CURRENT run's status, and Stop while the agent is
// live. Failed-run errors and resume failures render here, above and outside
// the message history: run lifecycle is state, not chat.

/** Run statuses that still hold a live agent process — Stop offers itself for
 * these; a settled session offers nothing (reopening auto-resumes instead). */
const STOPPABLE_STATUSES: ReadonlySet<TaskRun["status"]> = new Set([
	"running",
	"waiting_for_user",
]);

/** The failed run's actionable error, OUTSIDE the chat (§11.3). The action is
 * resume — the session continues as a new run of the same thread. */
function FailedRunBanner({ run }: { run: TaskRun }) {
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
		</div>
	);
}

/** A resume call that failed (computer offline, most likely) — the error and
 * its retry live here, outside the chat. */
function ResumeErrorBanner({
	message,
	onRetry,
	retryPending,
}: {
	message: string;
	onRetry: () => void;
	retryPending: boolean;
}) {
	return (
		<div
			className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3"
			role="alert"
		>
			<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
			<div className="min-w-0 flex-1">
				<p className="font-medium text-destructive text-sm">
					Couldn't resume this session
				</p>
				<p className="break-words text-muted-foreground text-sm">{message}</p>
			</div>
			<Button
				disabled={retryPending}
				onClick={onRetry}
				size="sm"
				variant="outline"
			>
				Retry
			</Button>
		</div>
	);
}

/** Back link + session name + computer · runtime — the "which session is
 * this" cluster, split out for the max-lines-per-function gate. The back link
 * returns to this agent's session list. */
function SessionIdentity({
	computerName,
	task,
}: {
	computerName: string | null;
	task: TaskDetail["task"];
}) {
	return (
		<>
			<Link
				aria-label="Back to sessions"
				className="text-muted-foreground transition-colors hover:text-foreground"
				params={{ agentKind: task.agentKind, computerId: task.computerId }}
				to="/computers/$computerId/agents/$agentKind"
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

/** The header's banner slot: a failed resume (with retry) wins over the
 * failed run's error — split out for the max-lines-per-function gate. */
function HeaderBanners({
	currentRun,
	onRetryResume,
	resumeError,
	resumePending,
}: {
	currentRun: TaskRun | null;
	onRetryResume: () => void;
	resumeError: string | null;
	resumePending: boolean;
}) {
	if (resumeError !== null) {
		return (
			<ResumeErrorBanner
				message={resumeError}
				onRetry={onRetryResume}
				retryPending={resumePending}
			/>
		);
	}
	if (currentRun?.status === "failed") {
		return <FailedRunBanner run={currentRun} />;
	}
	return null;
}

/** The lightweight header strip above the workspace pane: back link, session
 * name, computer · runtime, the current run's status chip, and Stop while the
 * agent is live. */
export function TaskConversationHeader({
	computerName,
	currentRun,
	onRetryResume,
	onStop,
	resumeError,
	resumePending,
	stopPending,
	task,
}: {
	computerName: string | null;
	currentRun: TaskRun | null;
	/** Re-runs a failed auto-resume — see ResumeErrorBanner. */
	onRetryResume: () => void;
	/** Ends the live run's bridge session (best-effort process stop). */
	onStop: () => void;
	/** The failed resume call's message, or null when none failed. */
	resumeError: string | null;
	resumePending: boolean;
	stopPending: boolean;
	task: TaskDetail["task"];
}) {
	return (
		<div className="flex shrink-0 flex-col gap-2 px-3 pt-3 sm:px-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<SessionIdentity computerName={computerName} task={task} />
				<StatusCluster
					currentRun={currentRun}
					onStop={onStop}
					stopPending={stopPending}
				/>
			</div>
			<HeaderBanners
				currentRun={currentRun}
				onRetryResume={onRetryResume}
				resumeError={resumeError}
				resumePending={resumePending}
			/>
		</div>
	);
}

/** The header's trailing cluster: the current run's status chip plus Stop
 * while the agent process is live. */
function StatusCluster({
	currentRun,
	onStop,
	stopPending,
}: {
	currentRun: TaskRun | null;
	onStop: () => void;
	stopPending: boolean;
}) {
	const stoppable =
		currentRun !== null &&
		currentRun.sessionId !== null &&
		STOPPABLE_STATUSES.has(currentRun.status);
	return (
		<div className="ml-auto flex items-center gap-2">
			<RunStatusChip status={currentRun?.status ?? null} />
			{stoppable && (
				<Button
					disabled={stopPending}
					onClick={onStop}
					size="sm"
					variant="outline"
				>
					<SquareIcon className="size-3.5" />
					Stop
				</Button>
			)}
		</div>
	);
}
