import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import type { TaskListItem } from "@/utils/api-types";

export type RunStatus = NonNullable<TaskListItem["latestRun"]>["status"];

const STATUS_LABELS: Record<RunStatus, string> = {
	completed: "Completed",
	created: "Queued",
	failed: "Failed",
	launching: "Launching",
	preparing_workspace: "Preparing workspace",
	running: "Running",
	starting_runtime: "Starting runtime",
	stopped: "Stopped",
	waiting_for_user: "Waiting for you",
};

// Status color semantics (S3-T1, revised): "the agent is working" is green,
// "the agent is BLOCKED on you" is amber — those used to share one green, but
// once sessions stopped ending on navigation the difference became the whole
// point of the global indicator. Failed is red; transitional/terminal states
// stay neutral.
const GREEN_STATUSES: ReadonlySet<RunStatus> = new Set(["running"]);

/** A session in one of these statuses is still a live work unit — it keeps
 * running in the background when you navigate away, so every list marks it. */
const LIVE_STATUSES: ReadonlySet<RunStatus> = new Set([
	"created",
	"launching",
	"preparing_workspace",
	"running",
	"starting_runtime",
	"waiting_for_user",
]);

/** Human label for one run status — shared with the conversation page's
 * composer lock so the wording can't drift from the chip's. */
export function runStatusLabel(status: RunStatus): string {
	return STATUS_LABELS[status];
}

/** Is this session still working (or launching), rather than settled? */
export function isLiveRunStatus(status: RunStatus | null): boolean {
	return status !== null && LIVE_STATUSES.has(status);
}

/** Is the agent blocked on the user? The one state worth shouting about. */
export function runNeedsAttention(status: RunStatus | null): boolean {
	return status === "waiting_for_user";
}

function dotClass(status: RunStatus | null): string {
	if (status === "failed") {
		return "bg-red-500";
	}
	if (runNeedsAttention(status)) {
		return "bg-amber-500";
	}
	if (status !== null && GREEN_STATUSES.has(status)) {
		return "bg-emerald-500";
	}
	return "bg-muted-foreground/30";
}

/** Latest-run status pill for the task list — same dot-in-badge shape as
 * ComputerStatusChip so the two lists read the same. The waiting-on-you state
 * additionally tints its text, so it stands out in a long list of chips. */
export function RunStatusChip({ status }: { status: RunStatus | null }) {
	return (
		<Badge
			className={cn(
				"gap-1.5",
				runNeedsAttention(status) && "text-amber-600 dark:text-amber-400"
			)}
			variant="outline"
		>
			<span
				aria-hidden
				className={cn("size-1.5 rounded-full", dotClass(status))}
			/>
			{status === null ? "No runs" : STATUS_LABELS[status]}
		</Badge>
	);
}
