import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import {
	collectAnsweredRequests,
	collectOpenRequestRows,
	type PendingRequestRow,
} from "../bridge/pending-requests";
import { userProcedure } from "../index";

// P5-1 (docs/local-agent-workspace-plan.md): pending-approval replay on
// (re)connect — split out of bridge.ts to keep that file under the repo's
// 300-line cap (same precedent as bridge-list-sessions.ts).
//
// Why the web needs this at all: the history seed is one bounded page
// (bridge.ts's DEFAULT_HISTORY_LIMIT, oldest-first) and the live relay is a
// rolling window with a TTL — a still-unanswered approval/question whose
// event fell between the two is invisible to a reconnecting client even
// though the CLI is still blocked on it. This endpoint reads the PERSISTED
// events tail instead (bridgeMessage.listTail), so the card can be replayed
// verbatim regardless of what the relay window still holds. `answered`
// additionally closes the cross-device hole: an answer travels as a relay
// COMMAND (never an event), so a device that didn't send it — or a reload of
// the one that did — has no other way to learn the card was already handled.

/** How many trailing persisted events to inspect for still-open requests. A
 * pending request is at most APPROVAL_TIMEOUT_MS (5 min) old on a live CLI —
 * the fail-closed timer retracts anything older — so it is always near the
 * tail; this bound matches the relay window size (relay-store.ts MAX_WINDOW). */
const PENDING_EVENTS_TAIL_LIMIT = 500;
/** How many trailing relay commands to inspect for already-sent answers —
 * generous next to listSessions' ATTENTION_TAIL_LIMIT since commands are far
 * sparser than events (only user sends land there). */
const PENDING_COMMANDS_TAIL_LIMIT = 200;
/** Open requests are only replayed for sessions seen this recently (mirrors
 * bridge-list-sessions.ts's ATTENTION_RECENCY_MS): a CLI that stopped polling
 * can never deliver an answer, and its pending timers died with it, so a
 * "still open" event from a dead session would be an unanswerable card. */
const PENDING_RECENCY_MS = 300_000;

/** Whether the session's CLI can still receive an answer: not ended, and
 * polling recently enough that its fail-closed timers are alive. */
function canStillAnswer(
	session: { lastSeenAt: Date; status: string } | null,
	nowMs: number
): boolean {
	return (
		session !== null &&
		session.status !== "ended" &&
		nowMs - new Date(session.lastSeenAt).getTime() <= PENDING_RECENCY_MS
	);
}

/**
 * The session's still-unanswered approval/question events (verbatim, with
 * their original seqs) plus the requestIds already answered from any device.
 * `pending` is empty for ended/stale sessions (nothing can answer them);
 * `answered` is always derived, so a replayed card in the seeded history can
 * still be marked answered even after the session ends.
 */
export const pendingRequests = userProcedure
	.input(z.object({ sessionId: z.uuid() }))
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		const commands = await context.services.relayStore.readTail(
			input.sessionId,
			"commands",
			PENDING_COMMANDS_TAIL_LIMIT
		);
		const answered = collectAnsweredRequests(
			commands.map((command) => command.data)
		);
		const nowMs = Date.now();
		const session = await context.services.stores.bridgeSession.get(
			input.sessionId
		);
		if (!canStillAnswer(session, nowMs)) {
			return { answered, pending: [] as PendingRequestRow[] };
		}
		const rows = await context.services.stores.bridgeMessage.listTail(
			input.sessionId,
			PENDING_EVENTS_TAIL_LIMIT
		);
		const answeredIds = new Set(answered.map((entry) => entry.requestId));
		const pending = collectOpenRequestRows(rows, nowMs).filter(
			(row) => !answeredIds.has(row.requestId)
		);
		return { answered, pending };
	});
