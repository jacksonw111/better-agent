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

// Status color semantics (S3-T1): the two "agent is live" states are green,
// failed is red, every transitional/terminal state stays neutral.
const GREEN_STATUSES: ReadonlySet<RunStatus> = new Set([
	"running",
	"waiting_for_user",
]);

function dotClass(status: RunStatus | null): string {
	if (status === "failed") {
		return "bg-red-500";
	}
	if (status !== null && GREEN_STATUSES.has(status)) {
		return "bg-emerald-500";
	}
	return "bg-muted-foreground/30";
}

/** Latest-run status pill for the task list — same dot-in-badge shape as
 * ComputerStatusChip so the two lists read the same. */
export function RunStatusChip({ status }: { status: RunStatus | null }) {
	return (
		<Badge className="gap-1.5" variant="outline">
			<span
				aria-hidden
				className={cn("size-1.5 rounded-full", dotClass(status))}
			/>
			{status === null ? "No runs" : STATUS_LABELS[status]}
		</Badge>
	);
}
