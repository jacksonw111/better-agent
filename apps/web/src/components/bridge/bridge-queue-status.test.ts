import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	latestQueueUpdateDetail,
	parseQueueUpdateDetail,
} from "./bridge-queue-status";

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("returns null when no queue_update event has arrived", () => {
	expect(latestQueueUpdateDetail([])).toBeNull();
});

it("sums steering + followUp lengths into queuedCount", () => {
	expect(
		parseQueueUpdateDetail({ steering: ["a"], followUp: ["b", "c"] })
	).toEqual({ queuedCount: 3 });
});

it("treats a missing array as zero, when the other one is present", () => {
	expect(parseQueueUpdateDetail({ steering: ["a", "b"] })).toEqual({
		queuedCount: 2,
	});
	expect(parseQueueUpdateDetail({ followUp: ["a"] })).toEqual({
		queuedCount: 1,
	});
});

it("returns null (chip hidden) when neither steering nor followUp is an array", () => {
	expect(parseQueueUpdateDetail({})).toBeNull();
	expect(parseQueueUpdateDetail({ steering: "not-an-array" })).toBeNull();
	expect(parseQueueUpdateDetail(null)).toBeNull();
	expect(parseQueueUpdateDetail("nope")).toBeNull();
});

it("picks the latest queue_update off the feed, ignoring an earlier one", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "queue_update",
			detail: { steering: ["a"] },
		}),
		ev(2, { kind: "message", role: "assistant", text: "hi" }),
		ev(3, {
			kind: "status",
			status: "queue_update",
			detail: { steering: ["a", "b"], followUp: ["c"] },
		}),
	];
	expect(latestQueueUpdateDetail(events)).toEqual({ queuedCount: 3 });
});
