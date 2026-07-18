import {
	parseNormalizedEvent,
	type RawBridgeEvent,
	type StreamEvent,
} from "./bridge-events";

/**
 * How many recently-accepted ids the feed remembers (sorted ascending) for
 * out-of-order tolerance. The Redis relay allocates ids (INCR) and publishes
 * (pipeline) in separate round trips, so two concurrent appends can publish
 * out of id order — a pure `id > maxSeenId` high-water mark would then
 * permanently swallow the lower id when it arrives late. The ring lets
 * `mergeEvents` tell "already delivered" (in the ring → drop) apart from
 * "skipped by reordering" (not in the ring → backfill) for the recent window
 * where reordering can actually happen.
 */
export const RECENT_SEEN_IDS_LIMIT = 512;

/** Named diagnostic switch: flip to true to trace the feed's drop/gap
 * decisions (`web.drop` / `web.gap`) in the browser console when hunting a
 * lost-event report. Kept as a constant (not env) so it can never leak into a
 * production build accidentally left on. */
const DEBUG_FEED_EVENTS: boolean = false;

function debugFeed(message: string): void {
	if (!DEBUG_FEED_EVENTS) {
		return;
	}
	// biome-ignore lint/suspicious/noConsole: gated diagnostic tracing, see DEBUG_FEED_EVENTS
	// eslint-disable-next-line no-console
	console.debug(message);
}

export interface MergeResult {
	events: StreamEvent[];
	maxSeenId: number;
	/** Only the newly-parsed events accepted by this merge (empty when nothing
	 * was fresh), sorted by id — lets the feed reducer fold per-kind status
	 * details off just the new batch instead of rescanning `events`. */
	parsed: StreamEvent[];
	/** The updated recent-ids ring (sorted ascending, ≤ RECENT_SEEN_IDS_LIMIT
	 * entries) — thread it back into the next `mergeEvents` call. */
	seenIds: number[];
}

/** Appends `added` ids into the sorted ring, trimming the OLDEST ids past
 * `RECENT_SEEN_IDS_LIMIT`. Returns `seenIds` untouched when nothing was
 * added. */
export function pushSeenIds(seenIds: number[], added: number[]): number[] {
	if (added.length === 0) {
		return seenIds;
	}
	const merged = [...seenIds, ...added].sort((a, b) => a - b);
	const excess = merged.length - RECENT_SEEN_IDS_LIMIT;
	return excess > 0 ? merged.slice(excess) : merged;
}

/** Splits `incoming` into the rows to accept: drops ids already in the ring
 * (duplicates) and ids so old they aged out of the ring (can't be told apart
 * from a duplicate — dropped as stale rather than risking a double render). */
function filterFresh(
	maxSeenId: number,
	seenIds: number[],
	incoming: RawBridgeEvent[]
): RawBridgeEvent[] {
	const seen = new Set(seenIds);
	const staleFloor =
		seenIds.length >= RECENT_SEEN_IDS_LIMIT
			? (seenIds[0] ?? Number.NEGATIVE_INFINITY)
			: Number.NEGATIVE_INFINITY;
	const fresh: RawBridgeEvent[] = [];
	for (const raw of incoming) {
		if (seen.has(raw.id)) {
			continue;
		}
		if (raw.id <= maxSeenId && raw.id < staleFloor) {
			debugFeed(`web.drop reason=stale id=${raw.id} maxSeenId=${maxSeenId}`);
			continue;
		}
		seen.add(raw.id);
		fresh.push(raw);
	}
	return fresh;
}

/** Index at which a server event with `id` belongs: before the earliest
 * later-id server event, scanning from the tail (out-of-order ids always land
 * near it). Local echoes (negative ids) carry no server ordering, so they're
 * skipped rather than treated as a boundary. */
function insertionIndex(events: StreamEvent[], id: number): number {
	let index = events.length;
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const entry = events[i];
		if (!entry || entry.id < 0) {
			continue;
		}
		if (entry.id <= id) {
			break;
		}
		index = i;
	}
	return index;
}

/**
 * Merges `incoming` into `current`, deduped by id against BOTH the running
 * high-water mark and the recent-ids ring: ids above the mark append (the
 * common case), while an id at or under the mark that is NOT in the ring is
 * an out-of-order delivery of a real event — it backfills at its correct
 * position instead of being swallowed (see RECENT_SEEN_IDS_LIMIT's doc
 * comment for why that happens). Exact repeats and replay/live overlap still
 * dedupe, whichever source delivered them or how many times it retried.
 */
export function mergeEvents(
	current: StreamEvent[],
	maxSeenId: number,
	incoming: RawBridgeEvent[],
	seenIds: number[]
): MergeResult {
	const fresh = filterFresh(maxSeenId, seenIds, incoming);
	if (fresh.length === 0) {
		return { events: current, maxSeenId, parsed: [], seenIds };
	}
	const parsed: StreamEvent[] = [];
	const events = [...current];
	let nextMaxSeenId = maxSeenId;
	for (const raw of fresh) {
		if (raw.id > nextMaxSeenId + 1) {
			debugFeed(`web.gap from=${nextMaxSeenId} to=${raw.id}`);
		}
		nextMaxSeenId = Math.max(nextMaxSeenId, raw.id);
		const event = parseNormalizedEvent(raw.data);
		if (!event) {
			continue;
		}
		const entry: StreamEvent = { id: raw.id, event };
		parsed.push(entry);
		events.splice(insertionIndex(events, raw.id), 0, entry);
	}
	parsed.sort((a, b) => a.id - b.id);
	return {
		events,
		maxSeenId: nextMaxSeenId,
		parsed,
		seenIds: pushSeenIds(
			seenIds,
			fresh.map((raw) => raw.id)
		),
	};
}
