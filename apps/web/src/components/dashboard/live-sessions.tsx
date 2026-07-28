import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AgentKindIcon } from "@/components/bridge/local-agent-kind-icon";
import {
	AGENT_LABELS,
	type AgentKind,
} from "@/components/computers/agent-labels";
import { ActivityStateBadge } from "@/components/pty/activity-state-badge";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";

// Observability slice C: the cross-machine live-session panel. Every
// background-resident PTY session across ALL of a user's computers shows as one
// row with its coarse activity_state — so closing the tab and coming back tells
// you, without entering a terminal, which agent finished (idle/ended) and which
// is still busy (working). Data comes from `pty.listSessions` (per computer),
// fanned out over `computers.list`; it polls on a gentle cadence so the state
// tracks the agent without a realtime channel.

/** Gentle poll — the dashboard isn't a terminal, so a few seconds of lag on the
 * coarse state is fine and keeps the fan-out cheap. */
const LIVE_REFETCH_MS = 8000;

const SKELETON_KEYS = ["ls0", "ls1", "ls2"];

export interface LiveSessionRow {
	activityState: string | null;
	activityStateAt: string | Date | null;
	agentKind: AgentKind;
	computerId: string;
	computerName: string;
	lastActivityAt: string | Date;
	projectId: string | null;
	sessionId: string;
	title: string;
}

function toIso(value: string | Date): string {
	return value instanceof Date ? value.toISOString() : value;
}

/** Most-recent activity wins the sort so a session that just did something
 * floats to the top. Falls back to the last byte-activity time. */
function activityMs(row: LiveSessionRow): number {
	const at = row.activityStateAt ?? row.lastActivityAt;
	return new Date(toIso(at)).getTime();
}

function LiveSessionsSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			{SKELETON_KEYS.map((key) => (
				<Skeleton className="h-14 w-full rounded-xl" key={key} />
			))}
		</div>
	);
}

function LiveSessionsEmpty() {
	return (
		<p className="py-4 text-muted-foreground text-sm">
			No background sessions running. Open a terminal on a computer and it keeps
			running here — you'll see its status even after you close this page.
		</p>
	);
}

function LiveSessionRowItem({
	onOpen,
	row,
}: {
	onOpen: (computerId: string, sessionId: string) => void;
	row: LiveSessionRow;
}) {
	const at = row.activityStateAt ?? row.lastActivityAt;
	return (
		<button
			className="flex w-full items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
			onClick={() => onOpen(row.computerId, row.sessionId)}
			type="button"
		>
			<AgentKindIcon
				className="size-5 shrink-0 text-muted-foreground"
				kind={row.agentKind}
			/>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-sm">{row.title}</span>
				<span className="truncate text-muted-foreground text-xs">
					{row.computerName} · {AGENT_LABELS[row.agentKind]} ·{" "}
					{relativeTime(toIso(at))}
				</span>
			</span>
			<ActivityStateBadge className="shrink-0" state={row.activityState} />
		</button>
	);
}

/** Presentational panel — takes already-flattened rows so it renders in tests
 * without the query/router layers. */
export function LiveSessionsView({
	isPending,
	onOpen,
	rows,
}: {
	isPending: boolean;
	onOpen: (computerId: string, sessionId: string) => void;
	rows: LiveSessionRow[];
}) {
	const sorted = [...rows].sort((a, b) => activityMs(b) - activityMs(a));
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-medium text-sm">Background sessions</h2>
			{renderBody(isPending, sorted, onOpen)}
		</section>
	);
}

function renderBody(
	isPending: boolean,
	rows: LiveSessionRow[],
	onOpen: (computerId: string, sessionId: string) => void
) {
	if (isPending) {
		return <LiveSessionsSkeleton />;
	}
	if (rows.length === 0) {
		return <LiveSessionsEmpty />;
	}
	return (
		<div className="flex flex-col gap-2">
			{rows.map((row) => (
				<LiveSessionRowItem key={row.sessionId} onOpen={onOpen} row={row} />
			))}
		</div>
	);
}

/** Container: fan `pty.listSessions` out over every computer, flatten into
 * cross-machine rows, and reattach on click (same one-click path as the
 * per-computer session list). */
export function LiveSessions() {
	const navigate = useNavigate();
	const computersQuery = useQuery(orpc.computers.list.queryOptions());
	const computers = computersQuery.data ?? [];

	const sessionQueries = useQueries({
		queries: computers.map((computer) => ({
			...orpc.pty.listSessions.queryOptions({
				input: { computerId: computer.id },
			}),
			refetchInterval: LIVE_REFETCH_MS,
		})),
	});

	const rows: LiveSessionRow[] = computers.flatMap((computer, index) => {
		const sessions = sessionQueries[index]?.data?.sessions ?? [];
		return sessions.map((session) => ({
			activityState: session.activityState ?? null,
			activityStateAt: session.activityStateAt ?? null,
			agentKind: session.agentKind as AgentKind,
			computerId: computer.id,
			computerName: computer.name,
			lastActivityAt: session.lastActivityAt,
			projectId: session.projectId,
			sessionId: session.sessionId,
			title: session.title,
		}));
	});

	const isPending =
		computersQuery.isPending ||
		sessionQueries.some((queryResult) => queryResult.isPending);

	return (
		<LiveSessionsView
			isPending={isPending}
			onOpen={(computerId, sessionId) =>
				navigate({
					params: { computerId },
					search: { session: sessionId },
					to: "/terminal/$computerId",
				})
			}
			rows={rows}
		/>
	);
}
