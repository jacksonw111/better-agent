import {
	parseNormalizedEvent,
	type RawBridgeEvent,
	type StreamEvent,
} from "./bridge-events";

export interface MergeResult {
	events: StreamEvent[];
	maxSeenId: number;
	/** Only the newly-parsed events appended by this merge (empty when nothing
	 * was fresh) — lets the feed reducer fold per-kind status details off just
	 * the new tail instead of rescanning the whole `events` array. */
	parsed: StreamEvent[];
}

/**
 * Appends `incoming` onto `current`, deduped by id: only rows with
 * `id > maxSeenId` are kept, mirroring the server's own
 * `observeBridgeEvents` replay/live dedupe (see
 * packages/api/src/bridge/stream.ts). Since every source (SSE replay, SSE
 * live push, and the `observe(afterId)` poll fallback) is itself
 * id-ascending, a single running high-water mark is enough to drop both
 * exact repeats (a poll re-requesting an already-seen window) and
 * replay/live overlap (a reconnect re-delivering an id the live stream
 * already pushed) — no dropped events, no duplicates, regardless of which
 * source delivered them or how many times it retries.
 */
export function mergeEvents(
	current: StreamEvent[],
	maxSeenId: number,
	incoming: RawBridgeEvent[]
): MergeResult {
	const fresh = incoming.filter((raw) => raw.id > maxSeenId);
	if (fresh.length === 0) {
		return { events: current, maxSeenId, parsed: [] };
	}
	const parsed: StreamEvent[] = [];
	let nextMaxSeenId = maxSeenId;
	for (const raw of fresh) {
		const event = parseNormalizedEvent(raw.data);
		if (event) {
			parsed.push({ id: raw.id, event });
		}
		nextMaxSeenId = Math.max(nextMaxSeenId, raw.id);
	}
	return { events: [...current, ...parsed], maxSeenId: nextMaxSeenId, parsed };
}
