// The feed's optimistic-echo reconciliation, split out of use-bridge-feed.ts
// purely to keep that file under the repo's 300-line cap (same precedent as
// use-bridge-feed-pending.ts).

import type { StreamEvent } from "./bridge-events";

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
