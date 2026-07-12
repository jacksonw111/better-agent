import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import type { BridgeTurn } from "./bridge-turn-types";
import { createFoldCursor, foldIncremental } from "./fold-cursor";

// Identity + perf-sanity coverage for fold-cursor.ts — split out of
// fold-cursor.test.ts to stay under the repo's 300-line file cap.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

/** The repeated "shell tool started" event used by the brief's-scenario test
 * below — factored out purely to keep that test under the max-lines gate. */
const toolStart = (id: number): StreamEvent =>
	ev(id, {
		kind: "tool",
		id: "t1",
		name: "shell",
		input: { cmd: "ls" },
		status: "started",
	});

function expectCompletedToolBlock(turn: BridgeTurn): void {
	expect(turn.kind).toBe("assistant");
	if (turn.kind !== "assistant") {
		return;
	}
	const [block] = turn.blocks;
	expect(block.kind).toBe("tool");
	if (block.kind === "tool") {
		expect(block.tool.status).toBe("complete");
	}
}

function expectCompletedAssistantText(turn: BridgeTurn, text: string): void {
	expect(turn.kind).toBe("assistant");
	if (turn.kind !== "assistant") {
		return;
	}
	expect(turn.blocks).toEqual([{ kind: "text", text }]);
}

it("keeps the same array reference across a call with no new events", () => {
	const cursor = createFoldCursor();
	const events = [ev(1, { kind: "output", text: "hi" })];
	const first = foldIncremental(cursor, events);
	const second = foldIncremental(cursor, events);
	expect(second).toBe(first);
});

it("keeps the same array reference across a hidden mid-stream heartbeat", () => {
	const cursor = createFoldCursor();
	const opened = foldIncremental(cursor, [
		ev(1, { kind: "output", text: "hi" }),
	]);
	// `usage_update` is a hidden, non-boundary heartbeat — nothing turns-visible
	// changes, so the array reference should be stable even though something
	// new WAS folded.
	const afterHeartbeat = foldIncremental(cursor, [
		ev(1, { kind: "output", text: "hi" }),
		ev(2, { kind: "status", status: "usage_update", detail: { tokens: 1 } }),
	]);
	expect(afterHeartbeat).toBe(opened);
});

it("the R0-T4 brief's scenario: tool started, many unrelated events, tool completed — only that row's reference changes", () => {
	const cursor = createFoldCursor();
	const afterStart = foldIncremental(cursor, [toolStart(1)]);
	const toolTurnAtStart = afterStart[0];
	expect(toolTurnAtStart.kind).toBe("assistant");

	// Many later, unrelated events — a full session's worth of other turns.
	// Uses a real curated notice status (not an arbitrary string): an unknown
	// status is now silently absorbed by `foldStatus` (never a boundary, never
	// its own turn — see bridge-turns.ts), so it can no longer stand in for
	// "many unrelated visible turns" here.
	const middleEvents = Array.from({ length: 20 }, (_, index) =>
		ev(index + 2, { kind: "status", status: "restarting" })
	);
	const afterMiddle = foldIncremental(cursor, [toolStart(1), ...middleEvents]);
	// The middle batch's first status event is a turn boundary — it closes the
	// still-streaming tool turn, so THAT row legitimately gets a fresh
	// reference here too (its `streaming` flag flips off). What matters is
	// that it then stays STABLE through the rest of the middle batch.
	expect(afterMiddle[0]).not.toBe(toolTurnAtStart);
	const toolTurnAfterMiddle = afterMiddle[0];
	const unrelatedRow = afterMiddle[5];

	const afterComplete = foldIncremental(cursor, [
		toolStart(1),
		...middleEvents,
		ev(23, {
			kind: "tool",
			id: "t1",
			name: "shell",
			status: "completed",
			output: "ok",
		}),
	]);
	// The tool's row mutated in place, long after it stopped being the open
	// turn — it must STILL get a NEW top-level reference for `React.memo` to
	// pick up the completed status.
	expect(afterComplete[0]).not.toBe(toolTurnAfterMiddle);
	expectCompletedToolBlock(afterComplete[0]);
	// Unrelated rows created in the middle batch stay stable.
	expect(afterComplete[5]).toBe(unrelatedRow);
});

it("R1-T1: a late id-matched delta after finalize is dropped and does NOT mark the turn touched (no new reference)", () => {
	const cursor = createFoldCursor();
	const finalEvents = [
		ev(1, { kind: "output", text: "Sure, ", id: "item_1" }),
		ev(2, {
			kind: "message",
			role: "assistant",
			text: "Sure, let me check that for you.",
			id: "item_1",
		}),
	];
	const afterFinal = foldIncremental(cursor, finalEvents);
	const turnAfterFinal = afterFinal[0];

	const afterLateDelta = foldIncremental(cursor, [
		...finalEvents,
		ev(3, { kind: "output", text: "DUPLICATE-LATE", id: "item_1" }),
	]);

	// A dropped delta must not touch the turn: same top-level array reference
	// AND same row reference — nothing rendering-relevant happened — and the
	// text stays exactly what the final already committed.
	expect(afterLateDelta).toBe(afterFinal);
	expect(afterLateDelta[0]).toBe(turnAfterFinal);
	expectCompletedAssistantText(
		afterLateDelta[0],
		"Sure, let me check that for you."
	);
});

it("folding stays proportional to NEW events, not total history", () => {
	const cursor = createFoldCursor();
	const base = Array.from({ length: 5000 }, (_, i) =>
		ev(i + 1, { kind: "output", text: `chunk ${i}` })
	);
	foldIncremental(cursor, base);
	expect(cursor.processedEvents).toBe(5000);

	const withOneMore = [...base, ev(5001, { kind: "output", text: "one more" })];
	foldIncremental(cursor, withOneMore);
	// Only the single new event was processed — not the whole 5001-long array.
	expect(cursor.processedEvents).toBe(5001);
});
