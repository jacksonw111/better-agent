import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SessionWorkspacePane } from "@/components/bridge/session-workspace-pane";
import {
	MobileSidebarDrawer,
	SidebarDrawerToggle,
	useSidebarDrawer,
} from "@/components/bridge/workspace-drawer";
import type { TaskDetail, TaskRun } from "@/utils/api-types";
import { userAvatar } from "@/utils/avatar";
import { orpc } from "@/utils/orpc";
import { useCurrentUser } from "@/utils/use-current-user";
import { TaskChat } from "./task-chat";
import { TaskConversationHeader } from "./task-conversation-header";
import { TaskRunSidebar } from "./task-run-sidebar";

// S3-T2 (master spec §11/§17.3/§18.4): the /tasks/$taskId body. The
// conversation's first message is the stored Opening Message; the rest is the
// current run's bridge session, rendered through the SAME session workspace
// pane (chat + Files/Git/Shell inspection tabs) the /local workspace uses —
// with the run history in a left sidebar mirroring /local's session sidebar.
// Run status and startup errors live in the header strip — never as chat.

/** Poll cadence for tasks.get — run status moves server-side (launch, client
 * status reports, session binding), so the page follows on its own. Matches
 * the session-list cadence so the two surfaces feel equally live. */
const TASK_POLL_INTERVAL_MS = 5000;

/** The run the conversation shows: the explicitly selected one when it still
 * exists, otherwise the LATEST (runs come createdAt-ascending) — so a fresh
 * retry run takes over automatically and a stale selection can't strand the
 * page. */
export function pickCurrentRun(
	runs: TaskRun[],
	selectedRunId: string | null
): TaskRun | null {
	if (selectedRunId) {
		const match = runs.find((run) => run.id === selectedRunId);
		if (match) {
			return match;
		}
	}
	return runs.at(-1) ?? null;
}

function ConversationSkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
			<Skeleton className="h-7 w-64 rounded-lg" />
			<Skeleton className="h-8 w-full max-w-sm rounded-lg" />
			<Skeleton className="min-h-0 flex-1 rounded-xl" />
		</div>
	);
}

function TaskNotFound() {
	return (
		<div className="p-4 sm:p-6">
			<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
				This task wasn't found — it may have been removed, or the link is wrong.
			</p>
		</div>
	);
}

/** The right column: header strip (status/error/retry — outside the chat)
 * over the reused session workspace pane. The pane's `headerStart` slot takes
 * the <md drawer toggle, same placement as /local's. Split from
 * `ConversationBody` for the max-lines-per-function gate. */
function ConversationMain({
	currentRun,
	detail,
	drawerToggle,
	onRetry,
	retryPending,
}: {
	currentRun: TaskRun | null;
	detail: TaskDetail;
	drawerToggle: React.ReactNode;
	onRetry: () => void;
	retryPending: boolean;
}) {
	const { email } = useCurrentUser();
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<TaskConversationHeader
				computerName={detail.computerName}
				currentRun={currentRun}
				onRetry={onRetry}
				retryPending={retryPending}
				runs={detail.runs}
				task={detail.task}
			/>
			<SessionWorkspacePane
				chat={
					<TaskChat
						openingMessage={detail.task.openingMessage}
						run={currentRun}
						userAvatarUrl={email ? userAvatar(email) : undefined}
					/>
				}
				headerStart={drawerToggle}
				workspacePath={currentRun?.workspacePath ?? null}
			/>
		</div>
	);
}

/** The loaded page: the run sidebar (md+ aside; <md the shared overlay
 * drawer, mirroring /local's session sidebar) beside the conversation
 * column. Split from `TaskConversation` (which owns the queries and guards)
 * for the max-lines-per-function gate. */
function ConversationBody({
	detail,
	onRetry,
	onSelectRun,
	retryPending,
	selectedRunId,
}: {
	detail: TaskDetail;
	onRetry: () => void;
	onSelectRun: (runId: string) => void;
	retryPending: boolean;
	selectedRunId: string | null;
}) {
	const currentRun = pickCurrentRun(detail.runs, selectedRunId);
	const drawer = useSidebarDrawer(onSelectRun);
	const sidebar = (onSelect: (runId: string) => void) => (
		<TaskRunSidebar
			activeRunId={currentRun?.id ?? null}
			onSelectRun={onSelect}
			runs={detail.runs}
		/>
	);
	return (
		<div className="flex min-h-0 flex-1">
			<aside className="hidden w-64 shrink-0 flex-col bg-muted/30 md:flex">
				{sidebar(onSelectRun)}
			</aside>
			<ConversationMain
				currentRun={currentRun}
				detail={detail}
				drawerToggle={
					<SidebarDrawerToggle label="Show runs" onOpen={drawer.show} />
				}
				onRetry={onRetry}
				retryPending={retryPending}
			/>
			<MobileSidebarDrawer
				closeLabel="Close run list"
				onClose={drawer.close}
				open={drawer.open}
			>
				{sidebar(drawer.select)}
			</MobileSidebarDrawer>
		</div>
	);
}

/** The `/tasks/$taskId` body: polls tasks.get, follows the latest run (or an
 * explicit pick from the run switcher), and wires retry to a NEW sequential
 * run (§16) the page then follows. */
export function TaskConversation({ taskId }: { taskId: string }) {
	const queryClient = useQueryClient();
	const detailQuery = useQuery({
		...orpc.tasks.get.queryOptions({ input: { taskId } }),
		refetchInterval: TASK_POLL_INTERVAL_MS,
	});
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const retry = useMutation(
		orpc.tasks.retry.mutationOptions({
			onSuccess: ({ runId }: { runId: string }) => {
				setSelectedRunId(runId);
				queryClient.invalidateQueries({ queryKey: orpc.tasks.get.key() });
			},
			onError: (error: Error) => toast.error(error.message),
		})
	);

	if (detailQuery.isPending) {
		return <ConversationSkeleton />;
	}
	const detail = detailQuery.data;
	if (!detail) {
		return <TaskNotFound />;
	}
	return (
		<ConversationBody
			detail={detail}
			onRetry={() => retry.mutate({ taskId })}
			onSelectRun={setSelectedRunId}
			retryPending={retry.isPending}
			selectedRunId={selectedRunId}
		/>
	);
}
