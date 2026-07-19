import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BridgeChatRow } from "@/components/bridge/bridge-chat-row";
import {
	parseNormalizedEvent,
	type StreamEvent,
} from "@/components/bridge/bridge-events";
import type { BridgeTransport } from "@/components/bridge/bridge-transport";
import {
	type BridgeTurn,
	foldEventsToTurns,
} from "@/components/bridge/bridge-turns";
import {
	ShowEarlierButton,
	useTurnWindow,
} from "@/components/bridge/turn-window";
import { HISTORY_PAGE_LIMIT } from "@/components/bridge/use-bridge-connection-effects";
import type { TaskRun } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { relativeTime } from "@/utils/relative-time";

// P3 history continuity: resuming a session appends a NEW run with a NEW
// bridge session, but the conversation is one thread — the previous runs'
// persisted bridge history renders as read-only content ABOVE the live feed
// (mounted through the terminal's `leading` slot, like the Opening Message),
// in run order, so nothing the user saw ever disappears.
//
// OOM fix (fix-crash-2): each prior run starts COLLAPSED as a one-line
// summary — nothing is fetched and nothing mounts until the user expands it.
// A long run's transcript is thousands of events (with shiki-highlighted code
// blocks per tool card); eagerly fetching and fully mounting up to
// PRIOR_RUN_HISTORY_LIMIT of those above the live feed simply moved the
// "Aw, Snap" tab crash from the live feed (fixed by its FEED_WINDOW_SIZE
// windowing) into this leading slot. Expanding fetches that run's history
// once (immutable, cached) and mounts only the trailing window of turns
// through the SAME shared windowing piece the live feed uses
// (turn-window.tsx).

/** How many of the session's most recent PRIOR runs offer their history above
 * the live feed. Older runs stay in the database but off this screen. */
export const PRIOR_RUN_HISTORY_LIMIT = 3;

const EMPTY_ANSWERS: Record<string, string> = {};
const EMPTY_QUESTION_ANSWERS: Record<string, string[][]> = {};

function noopAnswer(): void {
	// read-only replay: request cards render as historical, never actionable
}

/** The session's runs that come BEFORE the current one and bound a bridge
 * session — capped to the newest PRIOR_RUN_HISTORY_LIMIT, oldest first so the
 * stack reads top-down in time order. */
export function priorRunsOf(
	runs: TaskRun[],
	currentRunId: string | undefined
): TaskRun[] {
	const currentIndex = runs.findIndex((run) => run.id === currentRunId);
	const before = currentIndex === -1 ? runs : runs.slice(0, currentIndex);
	return before
		.filter((run) => run.sessionId !== null)
		.slice(-PRIOR_RUN_HISTORY_LIMIT);
}

/** Pages through the run's ENTIRE persisted history via the `afterSeq`
 * cursor (the endpoint lists ascending, `HISTORY_PAGE_LIMIT` rows per page —
 * same protocol as the live feed's seed, see `seedHistoryPages` in
 * use-bridge-connection-effects.ts). Only ever called AFTER the user expands
 * the run, so a collapsed run costs zero fetches and zero resident events. */
async function fetchRunHistoryEvents(
	transport: BridgeTransport,
	sessionId: string
): Promise<StreamEvent[]> {
	const events: StreamEvent[] = [];
	let afterSeq = 0;
	for (;;) {
		const rows = await transport.history({
			sessionId,
			afterSeq,
			limit: HISTORY_PAGE_LIMIT,
		});
		for (const row of rows) {
			const event = parseNormalizedEvent(row.event);
			if (event) {
				events.push({ event, id: row.seq });
			}
		}
		const lastSeq = rows.at(-1)?.seq;
		const exhausted =
			rows.length < HISTORY_PAGE_LIMIT ||
			lastSeq === undefined ||
			lastSeq <= afterSeq;
		if (exhausted) {
			return events;
		}
		afterSeq = lastSeq;
	}
}

/** The collapsed/expanded one-line header for a prior run: the summary text
 * plus the toggle. Always rendered, so a collapsed run is exactly one row. */
function PriorRunSummary({
	expanded,
	onToggle,
	run,
	turnCount,
}: {
	expanded: boolean;
	onToggle: () => void;
	run: TaskRun;
	turnCount: number | undefined;
}) {
	const when = relativeTime(new Date(run.createdAt).toISOString());
	const count = turnCount === undefined ? "" : ` · ${turnCount} 条消息`;
	return (
		<div className="flex justify-center">
			<button
				aria-expanded={expanded}
				className="rounded-full px-4 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground"
				onClick={onToggle}
				type="button"
			>
				Earlier run{count} · {when} · {expanded ? "收起" : "展开"}
			</button>
		</div>
	);
}

/** The expanded transcript body: the trailing `FEED_WINDOW_SIZE` turns (the
 * shared live-feed window, see turn-window.tsx), earlier ones behind the
 * shared "Show earlier" control — rendered by the SAME chat rows as the live
 * feed, ended, with every request card inert. */
function PriorRunTurns({
	avatars,
	turns,
}: {
	avatars: ChatAvatars;
	turns: BridgeTurn[];
}) {
	const { hiddenCount, showEarlier } = useTurnWindow(turns.length);
	const visibleTurns = hiddenCount > 0 ? turns.slice(hiddenCount) : turns;
	return (
		<>
			{hiddenCount > 0 && (
				<ShowEarlierButton hiddenCount={hiddenCount} onExpand={showEarlier} />
			)}
			{visibleTurns.map((turn) => (
				<BridgeChatRow
					answered={EMPTY_ANSWERS}
					answeredQuestions={EMPTY_QUESTION_ANSWERS}
					avatars={avatars}
					ended
					key={turn.id}
					onAnswerApproval={noopAnswer}
					onAnswerQuestion={noopAnswer}
					turn={turn}
				/>
			))}
		</>
	);
}

/** The expanded state's body under the summary row: loading note, empty note,
 * or the windowed transcript — early-returned so `PriorRunBlock` stays under
 * the complexity gate. */
function PriorRunBody({
	avatars,
	loading,
	turns,
}: {
	avatars: ChatAvatars;
	loading: boolean;
	turns: BridgeTurn[] | null;
}) {
	if (loading) {
		return <p className="text-center text-muted-foreground text-xs">加载中…</p>;
	}
	if (!turns) {
		// fetch failed: degrade to the bare summary line — the live conversation
		// must never be blocked on backlog.
		return null;
	}
	if (turns.length === 0) {
		return (
			<p className="text-center text-muted-foreground text-xs">没有消息</p>
		);
	}
	return <PriorRunTurns avatars={avatars} turns={turns} />;
}

/** One prior run: a one-line collapsed summary; expanding lazily fetches the
 * run's history (once — a finished run's history is immutable) and renders
 * the windowed transcript. Failures degrade to the bare summary line — the
 * live conversation must never be blocked on backlog. */
function PriorRunBlock({
	run,
	transport,
	userAvatarUrl,
}: {
	run: TaskRun;
	transport: BridgeTransport;
	userAvatarUrl: string | undefined;
}) {
	const [expanded, setExpanded] = useState(false);
	const historyQuery = useQuery({
		queryKey: ["task-prior-run-history", run.sessionId],
		queryFn: () => fetchRunHistoryEvents(transport, run.sessionId ?? ""),
		// Fetch nothing while collapsed — the whole point of the collapse.
		enabled: expanded,
		// A finished run's history is immutable — never refetch it.
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const turns = useMemo(
		() => (historyQuery.data ? foldEventsToTurns(historyQuery.data) : null),
		[historyQuery.data]
	);
	const avatars: ChatAvatars = {
		assistant: agentAvatar(run.session?.tokenId ?? run.id),
		user: userAvatarUrl,
	};
	return (
		<section aria-label="Earlier run" className="flex flex-col gap-6">
			<PriorRunSummary
				expanded={expanded}
				onToggle={() => setExpanded((value) => !value)}
				run={run}
				turnCount={turns?.length}
			/>
			{expanded && (
				<PriorRunBody
					avatars={avatars}
					loading={historyQuery.isLoading}
					turns={turns}
				/>
			)}
		</section>
	);
}

/**
 * The read-only replay of the session's previous runs, fetched lazily from
 * `bridge.history` per prior session ON EXPAND. Rendered inside the feed's
 * `leading` slot (after the Opening Message, before the live turns).
 */
export function PastRunHistory({
	runs,
	transport,
	userAvatarUrl,
}: {
	/** Prior runs (see priorRunsOf), oldest first, each with a sessionId. */
	runs: TaskRun[];
	transport: BridgeTransport;
	userAvatarUrl: string | undefined;
}) {
	if (runs.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-6 pt-4" data-testid="past-run-history">
			{runs.map((run) => (
				<PriorRunBlock
					key={run.id}
					run={run}
					transport={transport}
					userAvatarUrl={userAvatarUrl}
				/>
			))}
		</div>
	);
}
