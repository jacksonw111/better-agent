import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftIcon } from "lucide-react";
import type { TaskListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";
import { RunStatusChip } from "./task-status-chip";

// P3: the chat window's LEFT pane — the sibling sessions of the one being
// viewed (same computer + same agent runtime, via tasks.list's server-side
// narrowing), newest first, current highlighted. Replaces the per-task run
// sidebar: runs are an implementation detail now; switching happens between
// SESSIONS, and the conversation page owns the stop-then-resume transition
// (see task-conversation.tsx). Density and row treatment mirror the /local
// workspace's session sidebar; <md it mounts inside the shared
// MobileSidebarDrawer, md+ it can collapse into a slim icon rail.

/** Matches the session-list page's poll so both surfaces feel equally live. */
const SESSIONS_REFETCH_INTERVAL_MS = 10_000;

const GREEN_DOT_STATUSES: ReadonlySet<string> = new Set([
	"running",
	"waiting_for_user",
]);

function newestFirst(sessions: TaskListItem[]): TaskListItem[] {
	return [...sessions].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
}

/** Q3: a project session's siblings are the sessions of the SAME project; a
 * plain session keeps the full computer+agent list as before. */
export function siblingSessionsOf(
	sessions: TaskListItem[],
	projectId: string | null
): TaskListItem[] {
	if (projectId === null) {
		return sessions;
	}
	return sessions.filter((session) => session.projectId === projectId);
}

/** One session row: the whole row switches sessions (tint + radius, no
 * borders — same active/hover treatment as the /local session rows). */
function SessionRow({
	active,
	onSelect,
	session,
}: {
	active: boolean;
	onSelect: () => void;
	session: TaskListItem;
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
				<span className="truncate text-sm">{session.name}</span>
				<span className="truncate text-muted-foreground text-xs">
					{relativeTime(new Date(session.createdAt).toISOString())}
				</span>
			</span>
			<RunStatusChip status={session.latestRun?.status ?? null} />
		</button>
	);
}

function SidebarSkeleton() {
	return (
		<div className="flex flex-col gap-2 px-2">
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-10 w-full rounded-lg" />
		</div>
	);
}

type SessionAgentKind = TaskListItem["agentKind"];

export interface SessionSidebarProps {
	activeTaskId: string;
	agentKind: SessionAgentKind;
	computerId: string;
	/** Switches to a sibling session — the conversation page stops the current
	 * run first when it's still live (the stop -> resume transition). */
	onSelectSession: (taskId: string) => void;
	/** Q3: the viewed session's project — non-null narrows the sibling list to
	 * that project's sessions. */
	projectId: string | null;
}

/** The sibling-session query, shared by the expanded list and the collapsed
 * rail so collapsing never refetches. Narrowed client-side to the viewed
 * session's project when it has one. */
function useSiblingSessions(
	computerId: string,
	agentKind: SessionAgentKind,
	projectId: string | null
) {
	const query = useQuery({
		...orpc.tasks.list.queryOptions({ input: { agentKind, computerId } }),
		refetchInterval: SESSIONS_REFETCH_INTERVAL_MS,
	});
	return {
		...query,
		data: query.data ? siblingSessionsOf(query.data, projectId) : query.data,
	};
}

/** The expanded sidebar column — mounted in the md+ aside or the <md drawer
 * (the conversation page decides which). `onCollapse` is only wired for the
 * md+ aside; the drawer closes through its own backdrop instead. */
export function SessionSidebar({
	activeTaskId,
	agentKind,
	computerId,
	onCollapse,
	onSelectSession,
	projectId,
}: SessionSidebarProps & { onCollapse?: () => void }) {
	const sessionsQuery = useSiblingSessions(computerId, agentKind, projectId);
	const sessions = sessionsQuery.data;
	return (
		<nav
			aria-label="Sessions"
			className="flex min-h-0 flex-1 flex-col gap-2 pb-2"
		>
			<div className="flex shrink-0 items-center justify-between px-3 pt-3">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Sessions
				</p>
				{onCollapse && (
					<Button
						aria-label="Collapse session list"
						className="-my-1.5 hidden text-muted-foreground md:inline-flex"
						onClick={onCollapse}
						size="icon-sm"
						variant="ghost"
					>
						<PanelLeftIcon className="size-4" />
					</Button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2">
				{sessions ? (
					<div className="flex flex-col gap-0.5">
						{newestFirst(sessions).map((session) => (
							<SessionRow
								active={session.id === activeTaskId}
								key={session.id}
								onSelect={() => onSelectSession(session.id)}
								session={session}
							/>
						))}
					</div>
				) : (
					<SidebarSkeleton />
				)}
			</div>
		</nav>
	);
}

/** One collapsed-rail dot button — the session's live state as color, its
 * name as the accessible label/tooltip. */
function RailSessionButton({
	active,
	onSelect,
	session,
}: {
	active: boolean;
	onSelect: () => void;
	session: TaskListItem;
}) {
	return (
		<button
			aria-current={active ? "true" : undefined}
			aria-label={session.name}
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
				active ? "bg-muted/70" : "hover:bg-muted/40"
			)}
			onClick={onSelect}
			title={session.name}
			type="button"
		>
			<span
				aria-hidden
				className={cn(
					"size-2 rounded-full",
					GREEN_DOT_STATUSES.has(session.latestRun?.status ?? "")
						? "bg-emerald-500"
						: "bg-muted-foreground/40"
				)}
			/>
		</button>
	);
}

/** md+ collapsed state: a slim icon rail — the expand toggle on top, then one
 * dot button per sibling session (live ones green), so the list stays one
 * click away without the column. */
export function SessionSidebarRail({
	activeTaskId,
	agentKind,
	computerId,
	onExpand,
	onSelectSession,
	projectId,
}: SessionSidebarProps & { onExpand: () => void }) {
	const sessionsQuery = useSiblingSessions(computerId, agentKind, projectId);
	const sessions = sessionsQuery.data ?? [];
	return (
		<nav
			aria-label="Sessions (collapsed)"
			className="flex min-h-0 flex-1 flex-col items-center gap-1 pt-3 pb-2"
		>
			<Button
				aria-label="Expand session list"
				className="text-muted-foreground"
				onClick={onExpand}
				size="icon-sm"
				variant="ghost"
			>
				<PanelLeftIcon className="size-4" />
			</Button>
			<div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pt-1">
				{newestFirst(sessions).map((session) => (
					<RailSessionButton
						active={session.id === activeTaskId}
						key={session.id}
						onSelect={() => onSelectSession(session.id)}
						session={session}
					/>
				))}
			</div>
		</nav>
	);
}
