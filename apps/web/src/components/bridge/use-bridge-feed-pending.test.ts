import { expect, it } from "vitest";
import type { FeedState } from "./use-bridge-feed";
import { feedReducer, initialFeedState } from "./use-bridge-feed";

// P5-1: the `pendingReplay` feed path — replayed approval events append
// WITHOUT advancing `maxSeenId` (so the live connection still opens at the
// history seed's mark), and the remembered ids dedupe a later live
// redelivery of the same rows. See use-bridge-feed-pending.ts.

function approvalData(requestId: string) {
	return {
		kind: "approval",
		requestId,
		title: "Run?",
		options: [{ id: "allow", label: "Allow" }],
	};
}

/** A feed already seeded with history rows up to id 5. */
function seededState(): FeedState {
	return feedReducer(initialFeedState, {
		type: "events",
		events: [
			{ id: 4, data: { kind: "message", role: "assistant", text: "hi" } },
			{ id: 5, data: { kind: "message", role: "assistant", text: "yo" } },
		],
	});
}

it("appends a beyond-window event without advancing maxSeenId", () => {
	const state = feedReducer(seededState(), {
		type: "pendingReplay",
		events: [{ id: 42, data: approvalData("req-1") }],
	});

	expect(state.events.map((entry) => entry.id)).toEqual([4, 5, 42]);
	expect(state.maxSeenId).toBe(5);
	expect(state.replayedPendingIds).toEqual({ 42: true });
});

it("skips rows at or under the watermark — those already came via history", () => {
	const state = feedReducer(seededState(), {
		type: "pendingReplay",
		events: [{ id: 5, data: approvalData("req-1") }],
	});

	expect(state.events.map((entry) => entry.id)).toEqual([4, 5]);
	expect(state.replayedPendingIds).toEqual({});
});

it("dedupes a live redelivery of a replayed id and advances the watermark past it", () => {
	const replayed = feedReducer(seededState(), {
		type: "pendingReplay",
		events: [{ id: 42, data: approvalData("req-1") }],
	});

	const afterLive = feedReducer(replayed, {
		type: "events",
		events: [
			{ id: 41, data: { kind: "message", role: "assistant", text: "pre" } },
			{ id: 42, data: approvalData("req-1") },
		],
	});
	// 41 lands in id order BEFORE the replayed 42 card (out-of-order backfill).
	expect(afterLive.events.map((entry) => entry.id)).toEqual([4, 5, 41, 42]);
	expect(afterLive.maxSeenId).toBe(42);
	expect(afterLive.replayedPendingIds).toEqual({});
	// The retired replayed id joins the seen ring, so a SECOND redelivery of
	// 42 can't backfill a duplicate through the out-of-order path.
	const redelivered = feedReducer(afterLive, {
		type: "events",
		events: [{ id: 42, data: approvalData("req-1") }],
	});
	expect(redelivered.events.map((entry) => entry.id)).toEqual([4, 5, 41, 42]);
});

it("keeps merging genuinely new live events after a replay", () => {
	const replayed = feedReducer(seededState(), {
		type: "pendingReplay",
		events: [{ id: 42, data: approvalData("req-1") }],
	});

	const afterLive = feedReducer(replayed, {
		type: "events",
		events: [
			{ id: 43, data: { kind: "message", role: "assistant", text: "next" } },
		],
	});
	expect(afterLive.events.map((entry) => entry.id)).toEqual([4, 5, 42, 43]);
	expect(afterLive.maxSeenId).toBe(43);
});

it("skips replayed rows whose payload doesn't parse as a normalized event", () => {
	const state = feedReducer(seededState(), {
		type: "pendingReplay",
		events: [{ id: 42, data: "not-an-event" }],
	});

	expect(state.events.map((entry) => entry.id)).toEqual([4, 5]);
	expect(state.replayedPendingIds).toEqual({});
});
