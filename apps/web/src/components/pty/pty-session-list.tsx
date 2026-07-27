import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import {
	AGENT_LABELS,
	type AgentKind,
} from "@/components/computers/agent-labels";
import { EmptyState } from "@/components/layout/empty-state";
import { orpc } from "@/utils/orpc";
import { type PtySessionRow, SessionRow } from "./pty-session-row";

// P25-B: the one-click PTY entry. `pty.listSessions` is the server's source of
// truth for the computer's live (background-resident) sessions; this lists them
// so re-entering a project or computer REATTACHES in a single click — the whole
// row navigates to /terminal/$computerId?session=<id>, and the CLI replays that
// session's scrollback (running agent + history intact). "New session" mints a
// fresh session and opens it in one step. There is no select→start detour: the
// list IS the entry. A projectId scopes both the list and New (cwd = the
// checkout); without one the sessions run in the computer's home directory.
//
// P25-B fix: an `agentKind` narrows the list to ONE runtime — the agent entry
// (/computers/$id/agents/$agentKind) reuses this same one-click list instead of
// the old task-based landing page. With it the list shows only that runtime's
// sessions and New is a single button for that runtime; without it the whole
// computer/project is shown with a New button per installed runtime.

/** Poll cadence for the live-session list — brisk enough that a session you
 * just opened (or one that just ended elsewhere) shows up without a refresh. */
const LIST_REFETCH_INTERVAL_MS = 5000;

function SessionsSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			<Skeleton className="h-14 w-full rounded-xl" />
			<Skeleton className="h-14 w-full rounded-xl" />
		</div>
	);
}

/** One New-session control per installed runtime (a bare "New session" when
 * there's only one), each opening that runtime in one step. */
function newSessionLabel(
	kind: AgentKind,
	single: boolean,
	pendingKind: AgentKind | null
): string {
	if (pendingKind === kind) {
		return "Opening…";
	}
	return single ? "New session" : `New ${AGENT_LABELS[kind]}`;
}

function NewSessionButtons({
	disabled,
	onNew,
	pendingKind,
	runtimes,
}: {
	disabled: boolean;
	onNew: (kind: AgentKind) => void;
	pendingKind: AgentKind | null;
	runtimes: readonly AgentKind[];
}) {
	const single = runtimes.length === 1;
	return (
		<div className="flex flex-wrap gap-2">
			{runtimes.map((kind) => (
				<Button
					disabled={disabled || pendingKind !== null}
					key={kind}
					onClick={() => onNew(kind)}
					size="sm"
					type="button"
				>
					<PlusIcon className="size-4" />
					{newSessionLabel(kind, single, pendingKind)}
				</Button>
			))}
		</div>
	);
}

/** createSession → open the fresh terminal in one navigation (carrying the
 * resolved spawn spec so the CLI spawns on first OPEN). */
function useNewSession(computerId: string, projectId?: string) {
	const navigate = useNavigate();
	const create = useMutation(
		orpc.pty.createSession.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
			onSuccess: (session) => {
				navigate({
					params: { computerId },
					search: {
						cmd: session.command,
						cwd: session.cwd,
						session: session.sessionId,
					},
					to: "/terminal/$computerId",
				});
			},
		})
	);
	const start = (agentKind: AgentKind) =>
		create.mutate({ agentKind, computerId, projectId });
	return {
		pendingKind: create.isPending
			? (create.variables?.agentKind as AgentKind)
			: null,
		start,
	};
}

/** endSession → refresh the list so the ended row drops out. */
function useEndSession() {
	const queryClient = useQueryClient();
	const end = useMutation(
		orpc.pty.endSession.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.pty.listSessions.key(),
				});
				toast.success("Session ended");
			},
		})
	);
	return {
		end: (sessionId: string) => end.mutate({ sessionId }),
		endingId: end.isPending ? (end.variables?.sessionId as string) : null,
	};
}

function SessionListBody({
	computerId,
	endingId,
	newControl,
	onEnd,
	runtimes,
	sessions,
}: {
	computerId: string;
	endingId: string | null;
	newControl: React.ReactNode;
	onEnd: (sessionId: string) => void;
	runtimes: readonly AgentKind[];
	sessions: PtySessionRow[] | undefined;
}) {
	if (!sessions) {
		return <SessionsSkeleton />;
	}
	if (sessions.length === 0) {
		return (
			<EmptyState
				action={runtimes.length > 0 ? newControl : undefined}
				body="Open a terminal here and it keeps running in the background — leave and come back and you land right where you left off, scrollback and all. End a session when you're done with it."
				icon={TerminalIcon}
				title="No terminal sessions yet"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{sessions.map((session) => (
				<SessionRow
					computerId={computerId}
					ending={endingId === session.sessionId}
					key={session.sessionId}
					onEnd={() => onEnd(session.sessionId)}
					session={session}
				/>
			))}
		</div>
	);
}

interface PtySessionListProps {
	agentKind?: AgentKind;
	computerId: string;
	online?: boolean;
	projectId?: string;
	runtimes?: readonly AgentKind[];
}

/** With an agentKind, narrow the list to that one runtime (client-side); the
 * server returns every runtime's sessions on the computer/project. */
function selectSessions(
	sessions: PtySessionRow[] | undefined,
	agentKind: AgentKind | undefined
): PtySessionRow[] | undefined {
	if (!(sessions && agentKind)) {
		return sessions;
	}
	return sessions.filter((session) => session.agentKind === agentKind);
}

/**
 * The live PTY sessions on a computer (optionally scoped to a project), each
 * row a one-click reattach and a New-session control per runtime. Placed on
 * the Computer detail (home-dir sessions) and Project detail (checkout-dir
 * sessions) so entering either surface lands straight on "reattach or start".
 * An `agentKind` narrows both the list and New to that single runtime — the
 * agent entry page reuses this list for its one runtime.
 */
export function PtySessionList({
	agentKind,
	computerId,
	online = true,
	projectId,
	runtimes,
}: PtySessionListProps) {
	const sessionsQuery = useQuery({
		...orpc.pty.listSessions.queryOptions({
			input: { computerId, projectId },
		}),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	const { pendingKind, start } = useNewSession(computerId, projectId);
	const { end, endingId } = useEndSession();

	// Scoped to one runtime → a single New button for it, and only its sessions.
	const effectiveRuntimes = agentKind ? [agentKind] : (runtimes ?? []);
	const sessions = selectSessions(
		sessionsQuery.data?.sessions as PtySessionRow[] | undefined,
		agentKind
	);

	const newControl = (
		<NewSessionButtons
			disabled={!online}
			onNew={start}
			pendingKind={pendingKind}
			runtimes={effectiveRuntimes}
		/>
	);

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-medium text-sm">Terminal sessions</h2>
				{effectiveRuntimes.length > 0 && newControl}
			</div>
			<SessionListBody
				computerId={computerId}
				endingId={endingId}
				newControl={newControl}
				onEnd={end}
				runtimes={effectiveRuntimes}
				sessions={sessions}
			/>
		</section>
	);
}
