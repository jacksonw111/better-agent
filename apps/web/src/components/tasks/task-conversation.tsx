import { Skeleton } from "@better-agent/ui/components/skeleton";
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { SessionWorkspacePane } from "@/components/bridge/session-workspace-pane";
import {
	MobileSidebarDrawer,
	SidebarDrawerToggle,
	useSidebarDrawer,
} from "@/components/bridge/workspace-drawer";
import type { TaskDetail } from "@/utils/api-types";
import { userAvatar } from "@/utils/avatar";
import { orpc } from "@/utils/orpc";
import { useCurrentUser } from "@/utils/use-current-user";
import { priorRunsOf } from "./past-run-history";
import {
	SessionSidebar,
	type SessionSidebarProps,
	SessionSidebarRail,
} from "./session-sidebar";
import { TaskChat } from "./task-chat";
import { TaskConversationHeader } from "./task-conversation-header";
import {
	type SessionLifecycle,
	useSessionLifecycle,
} from "./use-session-lifecycle";

// P3: the /tasks/$taskId body — one SESSION's chat. The left pane lists the
// sibling sessions (same computer + agent); the conversation always follows
// the session's LATEST run. Entering a settled session auto-resumes it and
// switching away from a live one stops its process first — both transitions
// veiled by the loading overlay (see use-session-lifecycle.ts). Earlier runs'
// history replays read-only above the live feed (past-run-history.tsx), so
// the thread never loses what came before.

/** Poll cadence for tasks.get — run status moves server-side (launch, client
 * status reports, session binding), so the page follows on its own. */
const TASK_POLL_INTERVAL_MS = 5000;

function ConversationSkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
			<Skeleton className="h-7 w-64 rounded-lg" />
			<Skeleton className="h-8 w-full max-w-sm rounded-lg" />
			<Skeleton className="min-h-0 flex-1 rounded-xl" />
		</div>
	);
}

function SessionNotFound() {
	return (
		<div className="p-4 sm:p-6">
			<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
				This session wasn't found — it may have been removed, or the link is
				wrong.
			</p>
		</div>
	);
}

/** The stop/resume transition veil: fades in over the chat column, blocking
 * input until the target run is live again. */
function TransitionOverlay({ label }: { label: string }) {
	return (
		<div
			className="session-overlay-in absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-xs"
			data-testid="session-transition-overlay"
			role="status"
		>
			<Loader2Icon
				aria-hidden
				className="size-5 animate-spin text-muted-foreground"
			/>
			<span className="text-muted-foreground text-sm">{label}</span>
		</div>
	);
}

/** The right column: header strip (status/errors — outside the chat) over the
 * reused session workspace pane, with the transition overlay veiling both
 * while a stop/resume is in flight. */
function ConversationMain({
	detail,
	drawerToggle,
	lifecycle,
}: {
	detail: TaskDetail;
	drawerToggle: React.ReactNode;
	lifecycle: SessionLifecycle;
}) {
	const { email } = useCurrentUser();
	const currentRun = detail.runs.at(-1) ?? null;
	const priorRuns = useMemo(
		() => priorRunsOf(detail.runs, currentRun?.id),
		[detail.runs, currentRun?.id]
	);
	return (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
			<TaskConversationHeader
				computerName={detail.computerName}
				currentRun={currentRun}
				onRetryResume={lifecycle.retryResume}
				onStop={lifecycle.stop}
				resumeError={lifecycle.resumeError}
				resumePending={lifecycle.resumePending}
				stopPending={lifecycle.stopPending}
				task={detail.task}
			/>
			<SessionWorkspacePane
				chat={
					<TaskChat
						openingMessage={detail.task.openingMessage}
						priorRuns={priorRuns}
						run={currentRun}
						userAvatarUrl={email ? userAvatar(email) : undefined}
					/>
				}
				headerStart={drawerToggle}
				workspacePath={currentRun?.workspacePath ?? null}
			/>
			{lifecycle.switching && <TransitionOverlay label="正在结束当前会话…" />}
			{!lifecycle.switching && lifecycle.resuming && (
				<TransitionOverlay label="正在恢复会话…" />
			)}
		</div>
	);
}

/** The md+ aside: the full session column, collapsible into a slim icon rail
 * (the width transition carries the collapse). Split out of
 * `ConversationBody` for the max-lines-per-function gate. */
function DesktopSidebar({
	sidebarProps,
}: {
	sidebarProps: SessionSidebarProps;
}) {
	const [collapsed, setCollapsed] = useState(false);
	return (
		<aside
			className={cn(
				"hidden shrink-0 flex-col bg-muted/30 transition-all duration-200 md:flex",
				collapsed ? "w-12" : "w-64"
			)}
		>
			{collapsed ? (
				<SessionSidebarRail
					{...sidebarProps}
					onExpand={() => setCollapsed(false)}
				/>
			) : (
				<SessionSidebar
					{...sidebarProps}
					onCollapse={() => setCollapsed(true)}
				/>
			)}
		</aside>
	);
}

/** The loaded page: the sibling-session sidebar (md+ aside, collapsible to an
 * icon rail; <md the shared overlay drawer) beside the conversation column. */
function ConversationBody({
	detail,
	lifecycle,
	taskId,
}: {
	detail: TaskDetail;
	lifecycle: SessionLifecycle;
	taskId: string;
}) {
	const drawer = useSidebarDrawer(lifecycle.selectSession);
	const sidebarProps: SessionSidebarProps = {
		activeTaskId: taskId,
		agentKind: detail.task.agentKind,
		computerId: detail.task.computerId,
		onSelectSession: lifecycle.selectSession,
	};
	return (
		<div className="flex min-h-0 flex-1">
			<DesktopSidebar sidebarProps={sidebarProps} />
			<ConversationMain
				detail={detail}
				drawerToggle={
					<SidebarDrawerToggle label="Show sessions" onOpen={drawer.show} />
				}
				lifecycle={lifecycle}
			/>
			<MobileSidebarDrawer
				closeLabel="Close session list"
				onClose={drawer.close}
				open={drawer.open}
			>
				<SessionSidebar {...sidebarProps} onSelectSession={drawer.select} />
			</MobileSidebarDrawer>
		</div>
	);
}

/** The `/tasks/$taskId` body: polls tasks.get and always follows the
 * session's latest run. The route keys this component by taskId, so every
 * session entry starts the lifecycle (auto-resume guard included) fresh. */
export function TaskConversation({ taskId }: { taskId: string }) {
	const detailQuery = useQuery({
		...orpc.tasks.get.queryOptions({ input: { taskId } }),
		refetchInterval: TASK_POLL_INTERVAL_MS,
	});
	const lifecycle = useSessionLifecycle(taskId, detailQuery.data);

	if (detailQuery.isPending) {
		return <ConversationSkeleton />;
	}
	const detail = detailQuery.data;
	if (!detail) {
		return <SessionNotFound />;
	}
	return (
		<ConversationBody detail={detail} lifecycle={lifecycle} taskId={taskId} />
	);
}
