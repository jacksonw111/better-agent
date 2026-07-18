// P5-1: the feed's pending-request replay path, split out of
// use-bridge-feed.ts to keep that file under the repo's 300-line cap.
//
// Why replayed events can't just ride the normal `events` merge: mergeEvents
// tracks a single running high-water mark, and a pending approval's seq sits
// ABOVE the history seed's window (that's exactly why it needs replaying).
// Merging it normally would jump `maxSeenId` past every not-yet-delivered
// event between the seed and the card, so the live SSE/poll connection —
// which opens at `afterId = maxSeenId` — would silently skip whatever the
// relay window still held in that range. So replayed rows are appended
// WITHOUT touching the mark, and their ids are remembered so a later live
// redelivery of the same event dedupes against them instead of double-render.

import type { StreamEvent } from "./bridge-events";
import { parseNormalizedEvent, type RawBridgeEvent } from "./bridge-events";
import type { FeedState } from "./use-bridge-feed";

/** Appends still-pending approval/question events (verbatim persisted rows,
 * id = seq) onto the feed without advancing `maxSeenId` — see this file's doc
 * comment. Rows at or under the mark are already in the feed via the history
 * seed (their answered/cancelled state folds normally) and are skipped. */
export function applyPendingReplay(
	state: FeedState,
	incoming: RawBridgeEvent[]
): FeedState {
	const additions: StreamEvent[] = [];
	const replayedIds: Record<number, true> = {};
	for (const raw of incoming) {
		if (raw.id <= state.maxSeenId || raw.id in state.replayedPendingIds) {
			continue;
		}
		const event = parseNormalizedEvent(raw.data);
		if (event) {
			additions.push({ id: raw.id, event });
			replayedIds[raw.id] = true;
		}
	}
	if (additions.length === 0) {
		return state;
	}
	return {
		...state,
		events: [...state.events, ...additions],
		replayedPendingIds: { ...state.replayedPendingIds, ...replayedIds },
	};
}

export interface ExtractReplayedResult {
	/** Ids dropped as already-replayed duplicates (empty when none) — the
	 * merge still advances `maxSeenId` past them so a poll doesn't refetch the
	 * same row forever, and folds them into the seen-ids ring so a SECOND
	 * redelivery doesn't backfill a copy via the out-of-order path. */
	droppedIds: number[];
	/** The remaining replayed-id set once this batch's duplicates are spent —
	 * the SAME object when nothing matched, so the common path stays
	 * allocation-free. */
	replayedPendingIds: FeedState["replayedPendingIds"];
	/** The incoming batch minus rows already rendered via pending replay. */
	rows: RawBridgeEvent[];
}

/** Splits an incoming live/poll batch against the replayed-pending id set:
 * ids already rendered by `applyPendingReplay` are dropped (and retired from
 * the set), everything else passes through to the normal merge. */
export function extractReplayedRows(
	replayedPendingIds: FeedState["replayedPendingIds"],
	incoming: RawBridgeEvent[]
): ExtractReplayedResult {
	const duplicates = incoming.filter((raw) => raw.id in replayedPendingIds);
	if (duplicates.length === 0) {
		return { droppedIds: [], replayedPendingIds, rows: incoming };
	}
	const remaining = { ...replayedPendingIds };
	const droppedIds: number[] = [];
	for (const raw of duplicates) {
		delete remaining[raw.id];
		droppedIds.push(raw.id);
	}
	return {
		droppedIds,
		replayedPendingIds: remaining,
		rows: incoming.filter((raw) => !(raw.id in replayedPendingIds)),
	};
}
