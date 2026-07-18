import { expect, it } from "vitest";
import { feedReducer, initialFeedState } from "./use-bridge-feed";

// Out-of-order tolerance at the REDUCER level (B1+C1 loss fix): the Redis
// relay can publish ids out of order, so an id at or under the high-water
// mark that was never actually delivered must backfill instead of being
// permanently swallowed. mergeEvents' own unit coverage lives in
// event-feed.test.ts — this pins the same guarantee through `feedReducer`,
// seenIds threading included. Kept in its own file so use-bridge-feed.test.ts
// stays under the repo's 300-line cap.

const statusRaw = (n: number) => ({
	id: n,
	data: { kind: "status", status: `step-${n}` },
});

it("renders both events when N+1 arrives before N, in id order, still deduped", () => {
	const first = feedReducer(initialFeedState, {
		type: "events",
		events: [statusRaw(1), statusRaw(3)],
	});
	expect(first.maxSeenId).toBe(3);

	const backfilled = feedReducer(first, {
		type: "events",
		events: [statusRaw(2)],
	});
	expect(backfilled.events.map((e) => e.id)).toEqual([1, 2, 3]);
	expect(backfilled.maxSeenId).toBe(3);

	// A repeat of the backfilled id (and of the tail) still dedupes.
	const repeated = feedReducer(backfilled, {
		type: "events",
		events: [statusRaw(2), statusRaw(3)],
	});
	expect(repeated.events.map((e) => e.id)).toEqual([1, 2, 3]);
});
