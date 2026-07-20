import type { RelayStore } from "@better-agent/agent/ports";
import {
	deriveSessionAttention,
	type SessionAttention,
} from "./session-attention";

// The READ half of the attention signal — the bounded relay tails that
// session-attention.ts's pure fold runs over, plus the liveness gate deciding
// whether a session is worth reading at all. Extracted from
// routers/bridge-list-sessions.ts so the sidebar's per-session badge and the
// global active-session view (routers/tasks-active.ts) derive "needs you" from
// exactly the same tails, bounds and rules — two implementations of this is
// how the two views end up disagreeing about whether a session is blocked.

/** How many trailing relay events/commands to inspect per session — a bounded
 * tail, never the full replay window. */
export const ATTENTION_TAIL_LIMIT = 50;

/** Attention is only derived for sessions seen within this window (5 min);
 * anything staler is offline, so "waiting on you"/"working" would mislead. */
export const ATTENTION_RECENCY_MS = 300_000;

/** Whether a session is worth an attention read at all: ended sessions are
 * never "working"/"waiting", and one not seen recently is offline. */
export function isAttentionEligible(
	session: { lastSeenAt: Date; status: string } | null,
	nowMs: number
): boolean {
	return (
		session !== null &&
		session.status !== "ended" &&
		nowMs - new Date(session.lastSeenAt).getTime() <= ATTENTION_RECENCY_MS
	);
}

/**
 * The attention signal for one session, from bounded tails of its relay
 * streams. Best-effort: a relay read failure degrades to null rather than
 * failing the caller's whole list — the signal is a hint, the rows are the
 * data.
 */
export async function readSessionAttention(
	relayStore: RelayStore,
	sessionId: string
): Promise<SessionAttention> {
	try {
		const [events, commands] = await Promise.all([
			relayStore.readTail(sessionId, "events", ATTENTION_TAIL_LIMIT),
			relayStore.readTail(sessionId, "commands", ATTENTION_TAIL_LIMIT),
		]);
		return deriveSessionAttention(
			events.map((event) => event.data),
			commands.map((command) => command.data)
		);
	} catch {
		return null;
	}
}
