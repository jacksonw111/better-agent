import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import { useQueries } from "@tanstack/react-query";
import { BridgeChatRow } from "@/components/bridge/bridge-chat-row";
import {
	parseNormalizedEvent,
	type StreamEvent,
} from "@/components/bridge/bridge-events";
import type { BridgeTransport } from "@/components/bridge/bridge-transport";
import { foldEventsToTurns } from "@/components/bridge/bridge-turns";
import type { TaskRun } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { relativeTime } from "@/utils/relative-time";

// P3 history continuity: resuming a session appends a NEW run with a NEW
// bridge session, but the conversation is one thread — the previous runs'
// persisted bridge history renders as read-only content ABOVE the live feed
// (mounted through the terminal's `leading` slot, like the Opening Message),
// in run order, so nothing the user saw ever disappears.

/** How many of the session's most recent PRIOR runs replay their history
 * above the live feed. Older runs stay in the database but off this screen —
 * each one is a full conversation transcript, and unbounded stacking is how
 * the feed windowing pain (FEED_WINDOW_SIZE) happened the first time. */
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

function toStreamEvents(
	rows: { event: unknown; seq: number }[]
): StreamEvent[] {
	const events: StreamEvent[] = [];
	for (const row of rows) {
		const event = parseNormalizedEvent(row.event);
		if (event) {
			events.push({ event, id: row.seq });
		}
	}
	return events;
}

/** One prior run's transcript: a quiet divider naming when it ran, then its
 * turns rendered by the SAME chat rows as the live feed — ended, with every
 * request card inert. */
function PriorRunBlock({
	run,
	rows,
	userAvatarUrl,
}: {
	rows: { event: unknown; seq: number }[];
	run: TaskRun;
	userAvatarUrl: string | undefined;
}) {
	const turns = foldEventsToTurns(toStreamEvents(rows));
	if (turns.length === 0) {
		return null;
	}
	const avatars: ChatAvatars = {
		assistant: agentAvatar(run.session?.tokenId ?? run.id),
		user: userAvatarUrl,
	};
	return (
		<section aria-label="Earlier run" className="flex flex-col gap-6">
			<p className="text-center text-muted-foreground text-xs">
				Earlier run · {relativeTime(new Date(run.createdAt).toISOString())}
			</p>
			{turns.map((turn) => (
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
		</section>
	);
}

/**
 * The read-only replay of the session's previous runs, fetched from
 * `bridge.history` per prior session. Rendered inside the feed's `leading`
 * slot (after the Opening Message, before the live turns). Failures degrade
 * to nothing — the live conversation must never be blocked on backlog.
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
	const historyQueries = useQueries({
		queries: runs.map((run) => ({
			queryKey: ["task-prior-run-history", run.sessionId],
			queryFn: () => transport.history({ sessionId: run.sessionId ?? "" }),
			// A finished run's history is immutable — never refetch it.
			staleTime: Number.POSITIVE_INFINITY,
			retry: false,
		})),
	});
	if (runs.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-6 pt-4" data-testid="past-run-history">
			{runs.map((run, index) => {
				const rows = historyQueries[index]?.data;
				if (!rows) {
					return null;
				}
				return (
					<PriorRunBlock
						key={run.id}
						rows={rows}
						run={run}
						userAvatarUrl={userAvatarUrl}
					/>
				);
			})}
		</div>
	);
}
