import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { AgentKindIcon } from "@/components/bridge/local-agent-kind-icon";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { EmptyState } from "@/components/layout/empty-state";
import { RunStatusChip } from "@/components/tasks/task-status-chip";
import type { TaskListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";

// P3: one agent's sessions on one computer — the body of
// /computers/$computerId/agents/$agentKind. A session is a chat thread (a
// Task row server-side); New session starts one directly with an empty
// description (no wizard) and lands in the chat.

/** Run statuses move server-side; the list follows on its own. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

export type AgentKind = keyof typeof AGENT_LABELS;

/** Narrow a path param to a real agent kind, or null for a bad link. */
export function parseAgentKind(value: string): AgentKind | null {
	return value in AGENT_LABELS ? (value as AgentKind) : null;
}

/** One session row: name, latest-run status chip, relative age — the whole
 * row opens the chat (tint + radius, no borders). */
function SessionRow({ session }: { session: TaskListItem }) {
	return (
		<Link
			className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 transition-colors hover:bg-muted/70"
			params={{ taskId: session.id }}
			to="/tasks/$taskId"
		>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-sm">{session.name}</span>
				<span className="truncate text-muted-foreground text-xs">
					{relativeTime(new Date(session.createdAt).toISOString())}
				</span>
			</span>
			<RunStatusChip status={session.latestRun?.status ?? null} />
		</Link>
	);
}

function SessionsSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			<Skeleton className="h-14 w-full rounded-xl" />
			<Skeleton className="h-14 w-full rounded-xl" />
			<Skeleton className="h-14 w-full rounded-xl" />
		</div>
	);
}

function NewSessionButton({
	onClick,
	pending,
}: {
	onClick: () => void;
	pending: boolean;
}) {
	return (
		<Button disabled={pending} onClick={onClick} size="sm" type="button">
			<PlusIcon />
			{pending ? "Starting…" : "New session"}
		</Button>
	);
}

/** Newest first — the session you just left (or just started) sits on top. */
function newestFirst(sessions: TaskListItem[]): TaskListItem[] {
	return [...sessions].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
}

function SessionListBody({
	onNewSession,
	pending,
	sessions,
}: {
	onNewSession: () => void;
	pending: boolean;
	sessions: TaskListItem[] | undefined;
}) {
	if (!sessions) {
		return <SessionsSkeleton />;
	}
	if (sessions.length === 0) {
		return (
			<EmptyState
				action={<NewSessionButton onClick={onNewSession} pending={pending} />}
				body="Start a session and chat with this agent on this computer — it picks up right here whenever you come back."
				icon={MessagesSquareIcon}
				title="No sessions yet"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{newestFirst(sessions).map((session) => (
				<SessionRow key={session.id} session={session} />
			))}
		</div>
	);
}

/**
 * The /computers/$computerId/agents/$agentKind body: this agent's sessions on
 * this computer (tasks.list narrowed server-side), newest first, plus the New
 * session button that starts one immediately — no wizard, no required
 * description.
 */
/** Agent icon + name over the computer's name — the "whose sessions are
 * these" cluster, split out for the max-lines-per-function gate. */
function AgentIdentity({
	agentKind,
	computerName,
}: {
	agentKind: AgentKind;
	computerName: string | undefined;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2.5">
			<AgentKindIcon
				className="size-5 shrink-0 text-muted-foreground"
				kind={agentKind}
			/>
			<div className="flex min-w-0 flex-col">
				<h1 className="truncate font-semibold text-lg">
					{AGENT_LABELS[agentKind]}
				</h1>
				{computerName && (
					<p className="truncate text-muted-foreground text-sm">
						{computerName}
					</p>
				)}
			</div>
		</div>
	);
}

/** tasks.create with an empty description — a pure chat session, no wizard —
 * landing in the chat on success. */
function useStartSession(computerId: string, agentKind: AgentKind) {
	const create = useMutation(
		orpc.tasks.create.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
		})
	);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const start = () =>
		create.mutate(
			{ agentKind, computerId, description: "" },
			{
				onSuccess: ({ taskId }: { taskId: string }) => {
					queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() });
					navigate({ params: { taskId }, to: "/tasks/$taskId" });
				},
			}
		);
	return { pending: create.isPending, start };
}

export function AgentSessionList({
	agentKind,
	computerId,
}: {
	agentKind: AgentKind;
	computerId: string;
}) {
	const sessionsQuery = useQuery({
		...orpc.tasks.list.queryOptions({ input: { agentKind, computerId } }),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	const computersQuery = useQuery(orpc.computers.list.queryOptions());
	const newSession = useStartSession(computerId, agentKind);
	const computerName = (computersQuery.data ?? []).find(
		(computer) => computer.id === computerId
	)?.name;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<AgentIdentity agentKind={agentKind} computerName={computerName} />
				<NewSessionButton
					onClick={newSession.start}
					pending={newSession.pending}
				/>
			</div>
			<SessionListBody
				onNewSession={newSession.start}
				pending={newSession.pending}
				sessions={sessionsQuery.data}
			/>
		</div>
	);
}
