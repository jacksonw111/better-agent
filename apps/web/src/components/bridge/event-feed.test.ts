import { expect, it } from "vitest";
import { mergeEvents, pushSeenIds, RECENT_SEEN_IDS_LIMIT } from "./event-feed";

// Top-level `it`s (no describe) to stay under the repo's
// max-lines-per-function cap — same pattern as use-bridge-feed-pending.test.ts.

const statusEvent = (n: number) => ({
	id: n,
	data: { kind: "status", status: `step-${n}` },
});

const NO_SEEN: number[] = [];

it("appends fresh events in order and advances the high-water mark", () => {
	const first = mergeEvents([], 0, [statusEvent(1), statusEvent(2)], NO_SEEN);
	expect(first.events.map((e) => e.id)).toEqual([1, 2]);
	expect(first.maxSeenId).toBe(2);
	expect(first.seenIds).toEqual([1, 2]);

	const second = mergeEvents(
		first.events,
		first.maxSeenId,
		[statusEvent(3)],
		first.seenIds
	);
	expect(second.events.map((e) => e.id)).toEqual([1, 2, 3]);
	expect(second.maxSeenId).toBe(3);
});

it("drops an exact repeat (poll re-requesting an already-seen window)", () => {
	const first = mergeEvents([], 0, [statusEvent(1), statusEvent(2)], NO_SEEN);
	const repeat = mergeEvents(
		first.events,
		first.maxSeenId,
		[statusEvent(1), statusEvent(2)],
		first.seenIds
	);
	expect(repeat.events.map((e) => e.id)).toEqual([1, 2]);
	expect(repeat.maxSeenId).toBe(2);
});

it("backfills an out-of-order id at its correct position (N+1 before N)", () => {
	const first = mergeEvents([], 0, [statusEvent(1), statusEvent(3)], NO_SEEN);
	expect(first.maxSeenId).toBe(3);

	const second = mergeEvents(
		first.events,
		first.maxSeenId,
		[statusEvent(2)],
		first.seenIds
	);
	expect(second.events.map((e) => e.id)).toEqual([1, 2, 3]);
	expect(second.maxSeenId).toBe(3);
	expect(second.seenIds).toEqual([1, 2, 3]);
});

it("still dedupes a repeat of a backfilled id", () => {
	const first = mergeEvents([], 0, [statusEvent(1), statusEvent(3)], NO_SEEN);
	const second = mergeEvents(
		first.events,
		first.maxSeenId,
		[statusEvent(2)],
		first.seenIds
	);
	const third = mergeEvents(
		second.events,
		second.maxSeenId,
		[statusEvent(2), statusEvent(3)],
		second.seenIds
	);
	expect(third.events.map((e) => e.id)).toEqual([1, 2, 3]);
	expect(third.maxSeenId).toBe(3);
});

it("accepts a replayed range it never saw, keeping only genuinely new rows", () => {
	// Live delivered 3 first; a reconnect replays 1..3 — 1 and 2 were never
	// seen (real events skipped by out-of-order publish), so they backfill,
	// while 3 dedupes.
	const live = mergeEvents([], 0, [statusEvent(3)], NO_SEEN);
	const replayed = mergeEvents(
		live.events,
		live.maxSeenId,
		[statusEvent(1), statusEvent(2), statusEvent(3)],
		live.seenIds
	);
	expect(replayed.events.map((e) => e.id)).toEqual([1, 2, 3]);
	expect(replayed.maxSeenId).toBe(3);
});

it("drops an id older than the tracked seen window as stale", () => {
	// Fill the ring past capacity so the oldest ids age out of tracking.
	const backlog = Array.from({ length: RECENT_SEEN_IDS_LIMIT + 10 }, (_, i) =>
		statusEvent(i + 1)
	);
	const seeded = mergeEvents([], 0, backlog, NO_SEEN);
	expect(seeded.seenIds).toHaveLength(RECENT_SEEN_IDS_LIMIT);

	// id 5 aged out of the ring — it can't be told apart from a duplicate,
	// so it must be dropped rather than re-rendered.
	const result = mergeEvents(
		seeded.events,
		seeded.maxSeenId,
		[statusEvent(5)],
		seeded.seenIds
	);
	expect(result.events).toBe(seeded.events);
	expect(result.parsed).toEqual([]);
});

it("advances maxSeenId past malformed frames without rendering them", () => {
	const result = mergeEvents(
		[],
		0,
		[{ id: 1, data: { kind: "not-a-real-kind" } }, statusEvent(2)],
		NO_SEEN
	);
	expect(result.events.map((e) => e.id)).toEqual([2]);
	expect(result.maxSeenId).toBe(2);
	// The malformed frame's id is still remembered as delivered.
	expect(result.seenIds).toEqual([1, 2]);
});

it("returns the same events reference when nothing is fresh", () => {
	const first = mergeEvents([], 0, [statusEvent(1)], NO_SEEN);
	const result = mergeEvents(first.events, 1, [statusEvent(1)], first.seenIds);
	expect(result.events).toBe(first.events);
});

it("keeps a trailing local echo (negative id) behind an appended event", () => {
	const first = mergeEvents([], 0, [statusEvent(1)], NO_SEEN);
	const withEcho = [
		...first.events,
		{
			id: -1,
			event: { kind: "message", role: "user", text: "hi" },
		} as (typeof first.events)[number],
	];
	const merged = mergeEvents(withEcho, 1, [statusEvent(2)], first.seenIds);
	expect(merged.events.map((e) => e.id)).toEqual([1, -1, 2]);
});

it("pushSeenIds merges, sorts, and trims to capacity from the oldest side", () => {
	const base = Array.from({ length: RECENT_SEEN_IDS_LIMIT }, (_, i) => i + 1);
	const next = pushSeenIds(base, [RECENT_SEEN_IDS_LIMIT + 1]);
	expect(next).toHaveLength(RECENT_SEEN_IDS_LIMIT);
	expect(next[0]).toBe(2);
	expect(next.at(-1)).toBe(RECENT_SEEN_IDS_LIMIT + 1);
});

it("pushSeenIds returns the same reference when nothing is added", () => {
	const base = [1, 2, 3];
	expect(pushSeenIds(base, [])).toBe(base);
});
