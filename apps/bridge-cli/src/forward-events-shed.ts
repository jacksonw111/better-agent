// A2 (event-loss audit): the normalized-event shed policy `forwardEvents`
// hands its push queue (see push-queue-shed.ts for the mechanism). Only
// streamed text deltas — `kind: "output"` chunks, which the eventual final
// `message` event supersedes — are droppable under backlog pressure;
// approvals/questions, final messages, tool/file events, and status/error
// events (turn_end, turn_usage, session_ready, errors…) are protected and
// never shed. Split out of forward-events.ts purely to keep that file under
// the repo's max-lines-per-file gate (and to keep forwardEvents itself
// generic: everything normalized-event-shaped lives here).

import type { QueuedEvent } from "./forward-events";
import { isRecord } from "./normalize/types";
import type { ShedPolicy } from "./push-queue";
import { EVENT_TRUNCATED_STATUS } from "./truncate-event";

/** The one droppable event class: a streamed text chunk (`OutputEvent`). */
const DELTA_EVENT_KIND = "output";

function isDroppableDelta(value: unknown): boolean {
	return isRecord(value) && value.kind === DELTA_EVENT_KIND;
}

/** The lightweight "some streamed output was elided here" marker — reuses
 * truncate-event.ts's `event_truncated` status (the shape the web already
 * renders) with a detail explaining what was dropped and why. */
function droppedDeltaMarker(droppedCount: number): unknown {
	return {
		detail: {
			droppedEvents: droppedCount,
			originalKind: DELTA_EVENT_KIND,
			reason: "push_backlog_overflow",
		},
		kind: "status",
		status: EVENT_TRUNCATED_STATUS,
	};
}

/**
 * Builds the `ShedPolicy` `forwardEvents` wires into its push queue. Marker
 * items mint their own idempotency keys — `<generationId>:shed:<seq>`,
 * salted exactly like ordinary event keys (see `ForwardEventsOptions.
 * generationId`) so an in-place restart can't collide a fresh generation's
 * marker with a prior one still inside the relay's dedup window.
 */
export function buildQueuedEventShedPolicy<T>(
	generationId: number | undefined
): ShedPolicy<QueuedEvent<T>> {
	let markerSeq = 0;
	return {
		isDroppable: (item) => isDroppableDelta(item.event),
		makeDropMarker: (droppedCount) => {
			markerSeq += 1;
			const idempotencyKey =
				generationId === undefined
					? `shed:${markerSeq}`
					: `${generationId}:shed:${markerSeq}`;
			// The marker is a normalized status event, not a `T` — forwardEvents
			// is generic, but every production caller instantiates T = unknown
			// (see run-bridge-session.ts), so the cast is confined to here.
			return { event: droppedDeltaMarker(droppedCount) as T, idempotencyKey };
		},
	};
}
