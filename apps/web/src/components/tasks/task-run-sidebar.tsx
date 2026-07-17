import { cn } from "@better-agent/ui/lib/utils";
import type { TaskRun } from "@/utils/api-types";
import { relativeTime } from "@/utils/relative-time";
import { RunStatusChip } from "./task-status-chip";

// The Task Conversation page's LEFT pane — every sequential run of this task
// (tasks.get returns them createdAt-ascending, so "Run N" is the Nth
// attempt), one row per run with its ordinal, relative start time and status
// chip. Clicking a row switches which run's session the right pane shows —
// this sidebar replaced the header's segmented run switcher. Density and row
// treatment mirror the /local workspace's session sidebar
// (local-agent-workspace-sidebar.tsx); <md it mounts inside the shared
// MobileSidebarDrawer instead of the md+ aside.

/** One run row: the whole row selects the run, matching the /local session
 * rows' active/hover tints (no borders — tint + radius only). */
function RunRow({
	active,
	ordinal,
	onSelect,
	run,
}: {
	active: boolean;
	onSelect: () => void;
	ordinal: number;
	run: TaskRun;
}) {
	return (
		<button
			aria-current={active ? "true" : undefined}
			className={cn(
				"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
				active ? "bg-muted/70" : "hover:bg-muted/40"
			)}
			onClick={onSelect}
			type="button"
		>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm">Run {ordinal}</span>
				<span className="truncate text-muted-foreground text-xs">
					{relativeTime(new Date(run.createdAt).toISOString())}
				</span>
			</span>
			<RunStatusChip status={run.status} />
		</button>
	);
}

/** The full sidebar column — rendered once per mount point (the md+ aside or
 * the <md drawer; the conversation page decides which). */
export function TaskRunSidebar({
	activeRunId,
	onSelectRun,
	runs,
}: {
	activeRunId: string | null;
	onSelectRun: (runId: string) => void;
	runs: TaskRun[];
}) {
	return (
		<nav aria-label="Runs" className="flex min-h-0 flex-1 flex-col gap-2 pb-2">
			<p className="shrink-0 px-3 pt-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Runs
			</p>
			<div className="min-h-0 flex-1 overflow-y-auto px-2">
				<div className="flex flex-col gap-0.5">
					{runs.map((run, index) => (
						<RunRow
							active={run.id === activeRunId}
							key={run.id}
							onSelect={() => onSelectRun(run.id)}
							ordinal={index + 1}
							run={run}
						/>
					))}
				</div>
			</div>
		</nav>
	);
}
