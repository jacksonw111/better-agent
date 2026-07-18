// A2 (class-aware overflow): how a `PushQueue` sheds load once its backlog
// exceeds `maxBufferedEvents`. The legacy behavior (drop the whole oldest
// batch, whatever it contains) indiscriminately lost approvals, final
// messages, and terminal status events during a push outage — exactly the
// events a reopened session cannot live without. With a `ShedPolicy`, only
// the droppable class (streamed text deltas, which the eventual final
// message supersedes anyway) is ever shed, oldest first; everything else is
// protected and the queue simply grows past the cap instead (protected
// events are small, so unbounded-ish growth during an outage is the lesser
// evil by far). Whenever anything IS shed, a single lightweight marker item
// is enqueued where the omission happened so the consumer (the web feed) can
// render "…some streamed output was elided here" rather than silently
// missing text.

export interface ShedPolicy<T> {
	/** True for an item that's safe to shed under backlog pressure (a streamed
	 * text delta). Protected classes — approvals/questions, final messages,
	 * status/error events, out-of-band shell/task events — return false and
	 * are NEVER dropped. */
	isDroppable(item: T): boolean;
	/** Builds the single lightweight marker item enqueued in place of the shed
	 * items, so the consumer knows `droppedCount` items were elided here. */
	makeDropMarker(droppedCount: number): T;
}

export function bufferedCount<T>(pending: T[][]): number {
	let total = 0;
	for (const batch of pending) {
		total += batch.length;
	}
	return total;
}

function removeEmptyBatches<T>(pending: T[][]): void {
	for (let index = pending.length - 1; index >= 0; index--) {
		if (pending[index]?.length === 0) {
			pending.splice(index, 1);
		}
	}
}

/** Strips droppable items out of `batch` (oldest first, only while the total
 * is still over the cap), returning how many were shed and mutating the
 * running total via `state`. */
function shedFromBatch<T>(
	batch: T[],
	policy: ShedPolicy<T>,
	state: { total: number },
	maxBufferedEvents: number
): T[] {
	const kept: T[] = [];
	for (const item of batch) {
		if (state.total > maxBufferedEvents && policy.isDroppable(item)) {
			state.total -= 1;
		} else {
			kept.push(item);
		}
	}
	return kept;
}

/** Class-aware `enforceCap` (see push-queue.ts): sheds droppable items —
 * oldest first — until the backlog is back within `maxBufferedEvents`,
 * never touching a protected item, and enqueues one marker item (plus an
 * `onWarning` with the class stats) whenever anything was shed. A backlog of
 * purely protected items is allowed to exceed the cap outright. */
export function shedDroppable<T>(
	pending: T[][],
	maxBufferedEvents: number,
	policy: ShedPolicy<T>,
	onWarning?: (message: string) => void
): void {
	const state = { total: bufferedCount(pending) };
	if (state.total <= maxBufferedEvents) {
		return;
	}
	const before = state.total;
	for (let index = 0; index < pending.length; index++) {
		if (state.total <= maxBufferedEvents) {
			break;
		}
		const batch = pending[index];
		if (batch) {
			pending[index] = shedFromBatch(batch, policy, state, maxBufferedEvents);
		}
	}
	const dropped = before - state.total;
	if (dropped === 0) {
		return;
	}
	removeEmptyBatches(pending);
	pending.unshift([policy.makeDropMarker(dropped)]);
	onWarning?.(
		`bridge: dropped ${dropped} buffered delta event(s), kept ${state.total} protected/newer event(s) — push backlog exceeded ${maxBufferedEvents}`
	);
}
