// The `queue_update` curated status event (R3-T1 Part A item 5) — pi's
// passthrough of the messages queued behind the in-flight turn. Split out of
// bridge-session-status.ts purely to keep that file under the repo's
// max-lines-per-file gate, the same way bridge-status-snapshot.ts already
// splits off `status_snapshot`; reuses its exported defensive parse helpers
// so this parses "trust nothing off the wire" the same way.
import type { StreamEvent } from "./bridge-events";
import { isRecord, latestStatusDetail } from "./bridge-session-status";

/** pi's `queue_update` passthrough — messages queued behind the in-flight
 * turn. Rendered as a small "已排队 N 条" chip next to the composer's
 * busy-input hint (see busy-input-hint.tsx). */
export const QUEUE_UPDATE_STATUS = "queue_update";

/** pi's `queue_update` payload — the busy-input chip only cares about the
 * total count, not which delivery mode (`steering` vs. `followUp`) each
 * queued message will take. ASSUMPTION (unverified, no `pi` binary in this
 * sandbox — per docs/local-agent-refactor-plan.md's researched
 * `queue_update{steering[], followUp[]}` shape): both fields are arrays of
 * queued messages; `parseQueueUpdateDetail` degrades to `null` (chip hidden)
 * whenever neither is actually an array, rather than guessing at a count. */
export interface QueueUpdateDetail {
	queuedCount: number;
}

function asOptionalArray(value: unknown): unknown[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

/** `null` whenever `detail` isn't a record, or neither `steering` nor
 * `followUp` is actually an array — the "skip silently if the detail shape
 * isn't there" degrade the brief calls for, since this shape is unverified. */
export function parseQueueUpdateDetail(
	detail: unknown
): QueueUpdateDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	const steering = asOptionalArray(detail.steering);
	const followUp = asOptionalArray(detail.followUp);
	if (!(steering || followUp)) {
		return null;
	}
	return { queuedCount: (steering?.length ?? 0) + (followUp?.length ?? 0) };
}

/** The latest `queue_update` detail on the feed, or `null` if none has
 * arrived yet (or it was malformed/unshaped). */
export function latestQueueUpdateDetail(
	events: StreamEvent[]
): QueueUpdateDetail | null {
	const detail = latestStatusDetail(events, QUEUE_UPDATE_STATUS);
	return detail === undefined ? null : parseQueueUpdateDetail(detail);
}
