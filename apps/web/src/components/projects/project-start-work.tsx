import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlayIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AgentKindIcon } from "@/components/bridge/local-agent-kind-icon";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { RunStatusChip } from "@/components/tasks/task-status-chip";
import type {
	ComputerListItem,
	ProjectListItem,
	TaskListItem,
} from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";

// Q3: the project detail's Start work block — pick one of the computer's
// agent runtimes, then a session. "New session" is the DEFAULT: it creates a
// project session (tasks.create with projectId and an empty description) and
// lands in the chat; picking an existing project session navigates straight
// there. The session list is tasks.list narrowed server-side to this
// computer+agent, then client-side to THIS project.

type AgentKind = ComputerListItem["runtimeInventory"][number]["agentKind"];

export const NEW_SESSION_ID = "new";

/** Only THIS project's sessions — the projectId projection filter. */
export function projectSessions(
	sessions: TaskListItem[] | undefined,
	projectId: string
): TaskListItem[] {
	return (sessions ?? []).filter((session) => session.projectId === projectId);
}

function ChoiceRow({
	checked,
	children,
	name,
	onSelect,
}: {
	checked: boolean;
	children: React.ReactNode;
	name: string;
	onSelect: () => void;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 transition-colors hover:bg-muted/60 has-checked:bg-muted/70">
			<input
				checked={checked}
				className="accent-foreground"
				name={name}
				onChange={onSelect}
				type="radio"
			/>
			{children}
		</label>
	);
}

function AgentPicker({
	onSelect,
	runtimes,
	selected,
}: {
	onSelect: (kind: AgentKind) => void;
	runtimes: ComputerListItem["runtimeInventory"];
	selected: AgentKind | null;
}) {
	return (
		<div className="flex flex-col gap-2">
			<h3 className="text-muted-foreground text-xs uppercase tracking-wide">
				Agent
			</h3>
			{runtimes.map((runtime) => (
				<ChoiceRow
					checked={selected === runtime.agentKind}
					key={runtime.agentKind}
					name="project-agent"
					onSelect={() => onSelect(runtime.agentKind)}
				>
					<AgentKindIcon
						className="size-4 shrink-0 text-muted-foreground"
						kind={runtime.agentKind}
					/>
					<span className="truncate text-sm">
						{AGENT_LABELS[runtime.agentKind]}
					</span>
				</ChoiceRow>
			))}
		</div>
	);
}

function SessionPicker({
	loading,
	onSelect,
	selected,
	sessions,
}: {
	loading: boolean;
	onSelect: (id: string) => void;
	selected: string;
	sessions: TaskListItem[];
}) {
	return (
		<div className="flex flex-col gap-2">
			<h3 className="text-muted-foreground text-xs uppercase tracking-wide">
				Session
			</h3>
			<ChoiceRow
				checked={selected === NEW_SESSION_ID}
				name="project-session"
				onSelect={() => onSelect(NEW_SESSION_ID)}
			>
				<span className="truncate text-sm">New session</span>
			</ChoiceRow>
			{loading && <Skeleton className="h-11 w-full rounded-xl" />}
			{sessions.map((session) => (
				<ChoiceRow
					checked={selected === session.id}
					key={session.id}
					name="project-session"
					onSelect={() => onSelect(session.id)}
				>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-sm">{session.name}</span>
						<span className="truncate text-muted-foreground text-xs">
							{relativeTime(new Date(session.createdAt).toISOString())}
						</span>
					</span>
					{/* Sessions survive navigation now, so the picker has to say which
					    of these are still running before you pick one. */}
					<RunStatusChip status={session.latestRun?.status ?? null} />
				</ChoiceRow>
			))}
		</div>
	);
}

/** New session -> tasks.create with projectId (empty description), existing
 * session -> straight navigation; both land in the chat. */
function useStartInProject(project: ProjectListItem) {
	const create = useMutation(
		orpc.tasks.create.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
		})
	);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const openChat = (taskId: string) =>
		navigate({ params: { taskId }, to: "/tasks/$taskId" });
	const start = (agentKind: AgentKind, sessionId: string) => {
		if (sessionId !== NEW_SESSION_ID) {
			openChat(sessionId);
			return;
		}
		create.mutate(
			{
				agentKind,
				computerId: project.computerId,
				description: "",
				projectId: project.id,
			},
			{
				onSuccess: ({ taskId }: { taskId: string }) => {
					queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() });
					openChat(taskId);
				},
			}
		);
	};
	return { pending: create.isPending, start };
}

/** The agent choice: the picked runtime, falling back to the computer's
 * first. Picking a different agent resets the session choice to "new". */
function useAgentChoice(runtimes: ComputerListItem["runtimeInventory"]) {
	const [picked, setPicked] = useState<AgentKind | null>(null);
	return {
		agentKind: picked ?? runtimes[0]?.agentKind ?? null,
		pick: setPicked,
	};
}

/** This computer+agent's sessions (server-narrowed), for the project filter. */
function useAgentSessions(
	project: ProjectListItem,
	agentKind: AgentKind | null
) {
	return useQuery({
		...orpc.tasks.list.queryOptions({
			input: {
				agentKind: agentKind ?? undefined,
				computerId: project.computerId,
			},
		}),
		enabled: agentKind !== null,
	});
}

function StartWorkFooter({
	onStart,
	pending,
	startable,
}: {
	onStart: () => void;
	pending: boolean;
	startable: boolean;
}) {
	return (
		<>
			{!startable && (
				<p className="text-muted-foreground text-xs">
					Sessions start once the project is ready and the computer is online.
				</p>
			)}
			<Button
				className="self-start"
				disabled={!startable || pending}
				onClick={onStart}
				type="button"
			>
				<PlayIcon />
				{pending ? "Starting…" : "Start"}
			</Button>
		</>
	);
}

export function ProjectStartWork({
	computer,
	online,
	project,
}: {
	computer: ComputerListItem | undefined;
	online: boolean;
	project: ProjectListItem;
}) {
	const runtimes = computer?.runtimeInventory ?? [];
	const { agentKind, pick } = useAgentChoice(runtimes);
	const [sessionId, setSessionId] = useState(NEW_SESSION_ID);
	const sessionsQuery = useAgentSessions(project, agentKind);
	const startable = online && project.status === "ready" && agentKind !== null;
	const { pending, start } = useStartInProject(project);
	const onPickAgent = (kind: AgentKind) => {
		pick(kind);
		setSessionId(NEW_SESSION_ID);
	};
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-medium text-sm">Start work</h2>
			<div className="grid gap-4 sm:grid-cols-2">
				<AgentPicker
					onSelect={onPickAgent}
					runtimes={runtimes}
					selected={agentKind}
				/>
				<SessionPicker
					loading={agentKind !== null && sessionsQuery.isPending}
					onSelect={setSessionId}
					selected={sessionId}
					sessions={projectSessions(sessionsQuery.data, project.id)}
				/>
			</div>
			<StartWorkFooter
				onStart={() => agentKind && start(agentKind, sessionId)}
				pending={pending}
				startable={startable}
			/>
		</section>
	);
}
