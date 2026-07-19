import type { CommandCatalogDetail } from "./bridge-command-catalog";
import type { RawBridgeEvent, StreamEvent } from "./bridge-events";
import type { QueueUpdateDetail } from "./bridge-queue-status";
import type { SessionListDetail } from "./bridge-session-list";
import type {
	SessionReadyDetail,
	TurnUsageDetail,
	UsageUpdateDetail,
} from "./bridge-session-status";
import type { StatusSnapshotDetail } from "./bridge-status-snapshot";
import { mergeEvents, pushSeenIds } from "./event-feed";
import {
	initialSessionReadyFold,
	type SessionReadyFold,
} from "./session-ready-fold";
import {
	nextAnsweredApprovals,
	nextAnsweredQuestions,
} from "./use-bridge-feed-answers";
import { stripAckedEchoes } from "./use-bridge-feed-echoes";
import {
	applyPendingReplay,
	extractReplayedRows,
} from "./use-bridge-feed-pending";
import { nextStatusDetails } from "./use-bridge-feed-status";

/** First id handed to an optimistic local echo. Local echoes count DOWN from
 * here (-1, -2, …); server ids are always ≥ 0, so a negative id can never
 * collide with one — which is why echoes can bypass `mergeEvents`'s
 * `maxSeenId` dedupe entirely. */
const INITIAL_LOCAL_ID = -1;

export interface FeedState {
	/** requestId -> chosen optionId, for approvals already answered this
	 * client session — a replayed approval for an answered requestId still
	 * renders disabled since this survives the event list being rebuilt. */
	answered: Record<string, string>;
	/** requestId -> submitted answers, for questions already answered this
	 * client session (R3-T3). Mirrors `answered` above. */
	answeredQuestions: Record<string, string[][]>;
	/** The latest `command_catalog` detail (R5-T1/R5-T2) — the live,
	 * richer replacement for `sessionReady.slashCommands` on adapters that push
	 * it (claude-code/pi/opencode-serve; ACP opencode still only reports
	 * `session_ready.slashCommands`, see terminal-body.tsx's fallback). `null`
	 * before any adapter has emitted one. */
	commandCatalog: CommandCatalogDetail | null;
	events: StreamEvent[];
	maxSeenId: number;
	/** Next id for an optimistic local echo — decrements on each `localEcho`,
	 * staying negative so it never collides with a server id. */
	nextLocalId: number;
	/** Count of optimistic echoes (negative-id user messages) still awaiting a
	 * server-persisted twin. Incremented on `localEcho`, decremented as
	 * `stripAckedEchoes` cancels one — a fast path skips that whole
	 * Map-build+filter pass on every merge while this is zero (the common,
	 * no-pending-echo case). */
	pendingEchoes: number;
	/** The latest `queue_update` detail (R3-T1 Part A), or `null` before one has
	 * arrived (or it was malformed) — see bridge-queue-status.ts. */
	queueUpdate: QueueUpdateDetail | null;
	/** P5-1: ids appended by a `pendingReplay` (still-open approval/question
	 * events replayed from ABOVE the seeded window) — kept OUT of `maxSeenId`
	 * so the live connection still starts at the seed's mark, with this set
	 * deduping the eventual live redelivery instead. See
	 * use-bridge-feed-pending.ts. */
	replayedPendingIds: Record<number, true>;
	/** Recently-accepted server ids (sorted ring, see RECENT_SEEN_IDS_LIMIT in
	 * event-feed.ts) — lets `mergeEvents` backfill an out-of-order delivery
	 * instead of swallowing it against the `maxSeenId` high-water mark. */
	seenIds: number[];
	/** The latest curated status details, folded incrementally off each merge's
	 * new tail instead of rescanning the whole `events` array per render.
	 * `null` before an event of that kind has arrived (or its latest one was
	 * malformed) — identical semantics to the old `latest*Detail(events)`
	 * tail scans, latest wins. */
	sessionList: SessionListDetail | null;
	sessionReady: SessionReadyDetail | null;
	/** The fold bookkeeping `sessionReady` above is DERIVED from (handshake
	 * base + id-tracked read-back patches) — fix-caps-regression: a read-back
	 * arriving before the handshake stashes here instead of fabricating a
	 * partial detail. See session-ready-fold.ts. */
	sessionReadyFold: SessionReadyFold;
	/** The latest `status_snapshot` detail, or `null` before a `getStatus`
	 * request has gotten a reply — see bridge-status-snapshot.ts. */
	statusSnapshot: StatusSnapshotDetail | null;
	turnUsage: TurnUsageDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}

export const initialFeedState: FeedState = {
	events: [],
	maxSeenId: 0,
	answered: {},
	answeredQuestions: {},
	commandCatalog: null,
	nextLocalId: INITIAL_LOCAL_ID,
	pendingEchoes: 0,
	queueUpdate: null,
	replayedPendingIds: {},
	seenIds: [],
	sessionList: null,
	sessionReady: null,
	sessionReadyFold: initialSessionReadyFold,
	statusSnapshot: null,
	turnUsage: null,
	usageUpdate: null,
};

// (`StatusDetails`/`nextStatusDetails` — the curated per-status-kind folding
// — moved to use-bridge-feed-status.ts for the max-lines-per-file gate.)

export type FeedAction =
	| { type: "events"; events: RawBridgeEvent[] }
	| { text: string; type: "localEcho" }
	| { optionId: string; requestId: string; type: "answer" }
	| { requestId: string; type: "unanswer" }
	/** R3-T3: mirrors "answer"/"unanswer" for a `question` turn. */
	| { answers: string[][]; requestId: string; type: "answerQuestion" }
	| { requestId: string; type: "unanswerQuestion" }
	/** P5-1: replays still-open approval/question events fetched from
	 * `bridge.pendingRequests` — appended without advancing `maxSeenId`, see
	 * use-bridge-feed-pending.ts. */
	| { events: RawBridgeEvent[]; type: "pendingReplay" }
	| { type: "reset" };

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
	switch (action.type) {
		case "reset":
			return initialFeedState;
		case "answer":
			return {
				...state,
				answered: { ...state.answered, [action.requestId]: action.optionId },
			};
		case "unanswer": {
			const answered = { ...state.answered };
			delete answered[action.requestId];
			return { ...state, answered };
		}
		case "answerQuestion":
			return {
				...state,
				answeredQuestions: {
					...state.answeredQuestions,
					[action.requestId]: action.answers,
				},
			};
		case "unanswerQuestion": {
			const answeredQuestions = { ...state.answeredQuestions };
			delete answeredQuestions[action.requestId];
			return { ...state, answeredQuestions };
		}
		case "pendingReplay":
			return applyPendingReplay(state, action.events);
		case "localEcho": {
			// Optimistic echo of the user's own line: appended directly (never
			// through `mergeEvents`) with a negative id, so it shows instantly and
			// leaves the server high-water mark untouched.
			const echo: StreamEvent = {
				id: state.nextLocalId,
				event: { kind: "message", role: "user", text: action.text },
			};
			return {
				...state,
				events: [...state.events, echo],
				nextLocalId: state.nextLocalId - 1,
				pendingEchoes: state.pendingEchoes + 1,
			};
		}
		default:
			return mergeFeedEvents(state, action.events);
	}
}

/** The `events` merge path: appends/dedupes the incoming batch, folds its
 * curated status details incrementally, and only runs the echo-strip pass when
 * an echo is actually pending. Split out to keep `feedReducer` under the repo's
 * max-lines-per-function gate. */
function mergeFeedEvents(
	state: FeedState,
	incoming: RawBridgeEvent[]
): FeedState {
	// P5-1: rows already rendered via pending replay are dropped here (their
	// ids still advance the mark AND the seen ring) — see use-bridge-feed-pending.ts.
	const { droppedIds, replayedPendingIds, rows } = extractReplayedRows(
		state.replayedPendingIds,
		incoming
	);
	const result = mergeEvents(
		state.events,
		state.maxSeenId,
		rows,
		state.seenIds
	);
	const droppedMaxId = droppedIds.length > 0 ? Math.max(...droppedIds) : 0;
	const maxSeenId = Math.max(result.maxSeenId, droppedMaxId);
	const seenIds = pushSeenIds(result.seenIds, droppedIds);
	const details = nextStatusDetails(state, result.parsed);
	// fix-approval-replay / fix-question-replay: fold the CLI's persisted
	// resolution events into the answered maps — see use-bridge-feed-answers.ts.
	const answered = nextAnsweredApprovals(state.answered, result.parsed);
	const answeredQuestions = nextAnsweredQuestions(
		state.answeredQuestions,
		result.parsed
	);
	if (state.pendingEchoes === 0) {
		return {
			...state,
			...details,
			answered,
			answeredQuestions,
			events: result.events,
			maxSeenId,
			replayedPendingIds,
			seenIds,
		};
	}
	const { events, stripped } = stripAckedEchoes(result.events);
	return {
		...state,
		...details,
		answered,
		answeredQuestions,
		events,
		maxSeenId,
		pendingEchoes: state.pendingEchoes - stripped,
		replayedPendingIds,
		seenIds,
	};
}
