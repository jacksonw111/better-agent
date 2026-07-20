// The feed's optimistic-echo reconciliation, split out of use-bridge-feed.ts
// purely to keep that file under the repo's 300-line cap (same precedent as
// use-bridge-feed-pending.ts).

import type { MessageEvent, StreamEvent } from "./bridge-events";
import type { EchoSendStatus } from "./send-outbox-types";

function isUserMessage(entry: StreamEvent): entry is StreamEvent & {
	event: { text: string };
} {
	const { event } = entry;
	return (
		event.kind === "message" &&
		event.role === "user" &&
		typeof event.text === "string"
	);
}

/** The user echo (negative id) this entry is, or `null` for anything else —
 * narrows to `MessageEvent` so the local-only send fields are reachable. */
function echoMessage(entry: StreamEvent): MessageEvent | null {
	const { event } = entry;
	if (entry.id >= 0 || event.kind !== "message" || event.role !== "user") {
		return null;
	}
	return event;
}

/** Is this entry the optimistic echo the outbox key `key` was minted for? */
function isEchoFor(entry: StreamEvent, key: string): boolean {
	return echoMessage(entry)?.sendKey === key;
}

export interface EchoStatusResult {
	events: StreamEvent[];
	/** Echoes this pass REMOVED (a discard) — subtracted from
	 * `FeedState.pendingEchoes` so the reducer's fast-path gate stays true. */
	removed: number;
}

/**
 * fix-send-outbox: reflects one outbox entry's delivery state onto the echoed
 * line it belongs to, so a message can never sit in the transcript looking
 * delivered when it isn't:
 *   - `"sending"`/`"failed"` stamp `sendStatus` (the row renders a progress
 *     hint / a failed state with retry+discard),
 *   - `"sent"` CLEARS it — the line is now an ordinary optimistic echo again,
 *     waiting to be cancelled by its persisted twin (`stripAckedEchoes`),
 *   - `"discarded"` drops the line entirely (the user gave up on it).
 * Returns `events` by identity when nothing matched, so the reducer can skip
 * a re-render for a status about an echo that's already been reconciled.
 */
export function applyEchoStatus(
	events: StreamEvent[],
	key: string,
	status: EchoSendStatus
): EchoStatusResult {
	if (status === "discarded") {
		const filtered = events.filter((entry) => !isEchoFor(entry, key));
		return { events: filtered, removed: events.length - filtered.length };
	}
	let found = false;
	const next = events.map((entry) => {
		const message = echoMessage(entry);
		if (!message || message.sendKey !== key) {
			return entry;
		}
		found = true;
		return { ...entry, event: { ...message, sendStatus: status } };
	});
	return { events: found ? next : events, removed: 0 };
}

export interface StripResult {
	events: StreamEvent[];
	/** How many pending echoes this pass cancelled — subtracted from
	 * `FeedState.pendingEchoes` so the fast-path gate stays accurate. */
	stripped: number;
}

/** Drops each optimistic echo (negative id) once its server-persisted twin
 * (id ≥ 0, same text) has arrived, so the user's own line shows instantly on
 * send AND isn't duplicated when the CLI's persisted copy comes back through
 * history/live. One server copy cancels exactly one pending echo. Only called
 * when at least one echo is actually pending (see the reducer's fast path). */
export function stripAckedEchoes(events: StreamEvent[]): StripResult {
	const serverTextCounts = new Map<string, number>();
	for (const entry of events) {
		if (entry.id >= 0 && isUserMessage(entry)) {
			serverTextCounts.set(
				entry.event.text,
				(serverTextCounts.get(entry.event.text) ?? 0) + 1
			);
		}
	}
	if (serverTextCounts.size === 0) {
		return { events, stripped: 0 };
	}
	let stripped = 0;
	const filtered = events.filter((entry) => {
		if (entry.id < 0 && isUserMessage(entry)) {
			const remaining = serverTextCounts.get(entry.event.text) ?? 0;
			if (remaining > 0) {
				serverTextCounts.set(entry.event.text, remaining - 1);
				stripped += 1;
				return false;
			}
		}
		return true;
	});
	return { events: filtered, stripped };
}
