import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import { Loader2Icon } from "lucide-react";
import type { ProjectListItem } from "@/utils/api-types";

export type ProjectStatus = ProjectListItem["status"];

// Q3: the clone lifecycle as a pill — the two in-flight states spin, the two
// terminal ones show the usual dot (same Badge shape as ComputerStatusChip /
// RunStatusChip so every list reads the same). The error MESSAGE renders in
// the row/header, not here — a chip can't carry a sentence.

const STATUS_LABELS: Record<ProjectStatus, string> = {
	cloning: "Cloning",
	created: "Queued",
	error: "Error",
	ready: "Ready",
};

const PENDING_STATUSES: ReadonlySet<ProjectStatus> = new Set([
	"created",
	"cloning",
]);

/** True while the clone is still queued or running — the poll gate. */
export function isClonePending(status: ProjectStatus): boolean {
	return PENDING_STATUSES.has(status);
}

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
	return (
		<Badge className="gap-1.5" variant="outline">
			{isClonePending(status) ? (
				<Loader2Icon
					aria-hidden
					className="size-3 animate-spin text-muted-foreground"
				/>
			) : (
				<span
					aria-hidden
					className={cn(
						"size-1.5 rounded-full",
						status === "ready" ? "bg-emerald-500" : "bg-red-500"
					)}
				/>
			)}
			{STATUS_LABELS[status]}
		</Badge>
	);
}
