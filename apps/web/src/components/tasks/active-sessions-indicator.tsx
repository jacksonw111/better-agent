import { Popover, PopoverContent } from "@better-agent/ui/components/popover";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { cn } from "@better-agent/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { relativeTime } from "@/utils/relative-time";
import {
	type ActiveComputerGroup,
	type ActiveSessionItem,
	activeSessionsSummary,
	groupActiveSessions,
	useActiveSessions,
} from "./active-sessions";
import {
	ActiveSessionsTrigger,
	type IndicatorVariant,
	indicatorState,
} from "./active-sessions-trigger";
import { RunStatusChip } from "./task-status-chip";

// The global active-session entry point, mounted in the sidebar footer and the
// mobile dock. Sessions keep running when you navigate away (see
// use-session-lifecycle.ts), so without this there is no way to find the ones
// still working — which is exactly the complaint it answers. Three visual
// states, driven by `data-state` so both mounts share one source of truth:
// idle (nothing running — deliberately still VISIBLE, a hidden entry reads as
// "the feature disappeared"), running (neutral count badge), attention (a
// session is blocked on you — the one state allowed to shout).

function agentLabel(agentKind: string): string {
	return AGENT_LABELS[agentKind as keyof typeof AGENT_LABELS] ?? agentKind;
}

/** One session row — the whole row opens the chat (tint + radius, no borders,
 * matching the session sidebar's rows). */
function ActiveSessionRow({
	onOpen,
	session,
}: {
	onOpen: (taskId: string) => void;
	session: ActiveSessionItem;
}) {
	return (
		<button
			className={cn(
				"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
				session.needsAttention
					? "bg-amber-500/10 hover:bg-amber-500/20"
					: "hover:bg-muted/60"
			)}
			data-attention={session.needsAttention ? "true" : undefined}
			data-testid={`active-session-row-${session.taskId}`}
			onClick={() => onOpen(session.taskId)}
			type="button"
		>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-sm">{session.name}</span>
				<span className="truncate text-muted-foreground text-xs">
					{agentLabel(session.agentKind)} ·{" "}
					{relativeTime(new Date(session.lastActivityAt).toISOString())}
				</span>
			</span>
			<RunStatusChip status={session.status} />
		</button>
	);
}

/** One computer's block: the computer name, then its project-less sessions and
 * each project's sessions under a sub-heading. */
function ComputerGroup({
	group,
	onOpen,
}: {
	group: ActiveComputerGroup;
	onOpen: (taskId: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<p className="px-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{group.computerName}
			</p>
			{group.projects.map((project) => (
				<div className="flex flex-col gap-0.5" key={project.key}>
					{project.projectName && (
						<p className="px-2 pt-1 text-muted-foreground text-xs">
							{project.projectName}
						</p>
					)}
					{project.sessions.map((session) => (
						<ActiveSessionRow
							key={session.taskId}
							onOpen={onOpen}
							session={session}
						/>
					))}
				</div>
			))}
		</div>
	);
}

function PanelSkeleton() {
	return (
		<div className="flex flex-col gap-2" data-testid="active-sessions-loading">
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-10 w-full rounded-lg" />
		</div>
	);
}

/** The panel body: loading / error / empty / the grouped list. */
function PanelBody({
	error,
	isPending,
	onOpen,
	sessions,
}: {
	error: Error | null;
	isPending: boolean;
	onOpen: (taskId: string) => void;
	sessions: ActiveSessionItem[] | undefined;
}) {
	if (error) {
		return (
			<p
				className="px-2 py-6 text-center text-destructive text-xs"
				role="alert"
			>
				{error.message}
			</p>
		);
	}
	if (isPending || !sessions) {
		return <PanelSkeleton />;
	}
	if (sessions.length === 0) {
		return (
			<p className="px-2 py-6 text-center text-muted-foreground text-xs">
				No sessions running. Start one from a computer and it keeps working
				here, even after you navigate away.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{groupActiveSessions(sessions).map((group) => (
				<ComputerGroup group={group} key={group.computerId} onOpen={onOpen} />
			))}
		</div>
	);
}

/** The mounted indicator. `side` lets the mobile dock open its panel upward
 * while the sidebar footer opens to the side; `variant` picks the trigger's
 * shape for that mount. */
export function ActiveSessionsIndicator({
	side = "top",
	variant = "bar",
}: {
	side?: "bottom" | "right" | "top";
	variant?: IndicatorVariant;
}) {
	const [open, setOpen] = useState(false);
	const { error, isPending, sessions } = useActiveSessions();
	const navigate = useNavigate();
	const summary = activeSessionsSummary(sessions ?? []);
	const state = indicatorState(summary.total, summary.needsAttention);
	const openSession = (taskId: string) => {
		setOpen(false);
		navigate({ params: { taskId }, to: "/tasks/$taskId" });
	};
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<ActiveSessionsTrigger
				attentionCount={summary.attentionCount}
				state={state}
				total={summary.total}
				variant={variant}
			/>
			<PopoverContent
				align="start"
				className="max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto"
				data-testid="active-sessions-panel"
				side={side}
			>
				<p className="px-2 font-medium text-sm">Active sessions</p>
				<PanelBody
					error={error as Error | null}
					isPending={isPending}
					onOpen={openSession}
					sessions={sessions}
				/>
			</PopoverContent>
		</Popover>
	);
}
