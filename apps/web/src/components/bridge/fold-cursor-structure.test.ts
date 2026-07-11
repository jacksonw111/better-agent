import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";
import { createFoldCursor, foldIncremental } from "./fold-cursor";
import {
	approvalRetractEvents,
	codexFinalReplacesDeltaEvents,
	ev,
	scenario,
} from "./fold-cursor-fixtures";

// R0-T4 CRITICAL FIX: `publish()` used to decide whether to rebuild the
// returned turns array from `state.turns.length !== turnsBefore` (a NET
// length delta) OR `touched.size > 0`. A plain push (status/error/file/
// task/plan/user/new-approval/finalize-without-id) never adds to `touched`,
// and an approval retract removes a turn via `state.turns = state.turns
// .filter(...)` without touching `touched` either. So when ONE incremental
// call's tail contained both a push and a retract, the length delta
// cancelled to zero AND touched stayed empty → `publish()` returned the
// STALE cached array, silently dropping the new turn and leaving the
// retracted approval card rendered forever.
//
// The one-event-at-a-time property tests in fold-cursor.test.ts never catch
// this: they only ever fold ONE event per call, so a push and a retract are
// never in the same tail. This file re-runs those SAME sequences with
// randomized multi-event (1-4) chunk tails, which is the shape that
// reproduces the bug — plus the reviewer's exact minimal repro.

/** Folds `events` through a fresh cursor in chunks of `chunkSizes[i]`
 * (cycling if the sequence runs out), instead of one event at a time — lets
 * a push and a retract land in the SAME incremental call. */
function foldInChunks(events: StreamEvent[], chunkSizes: number[]) {
	const cursor = createFoldCursor();
	let turns = foldIncremental(cursor, []);
	let folded = 0;
	let chunkIndex = 0;
	while (folded < events.length) {
		const size = chunkSizes[chunkIndex % chunkSizes.length];
		folded = Math.min(folded + size, events.length);
		turns = foldIncremental(cursor, events.slice(0, folded));
		chunkIndex += 1;
	}
	return turns;
}

const PARK_MILLER_MODULUS = 2_147_483_647;
const PARK_MILLER_MULTIPLIER = 16_807;

/** A small deterministic PRNG (Park-Miller LCG — no bitwise ops, so it stays
 * within the repo's lint rules) so the "random" chunk sizes are reproducible
 * across runs without pulling in a fuzzing dependency. */
function parkMillerRandom(seed: number): () => number {
	let state = seed % PARK_MILLER_MODULUS;
	if (state <= 0) {
		state += PARK_MILLER_MODULUS - 1;
	}
	return () => {
		state = (state * PARK_MILLER_MULTIPLIER) % PARK_MILLER_MODULUS;
		return (state - 1) / (PARK_MILLER_MODULUS - 1);
	};
}

function randomChunkSizes(seed: number, count: number): number[] {
	const rand = parkMillerRandom(seed);
	return Array.from({ length: count }, () => 1 + Math.floor(rand() * 4));
}

it("reviewer's exact repro: a push and a retract landing in the SAME incremental call", () => {
	const cursor = createFoldCursor();
	// Call 1: fold only the approval push.
	const afterPush = foldIncremental(cursor, [
		ev(1, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
	]);
	expect(afterPush.map((t) => t.kind)).toEqual(["approval"]);

	// Call 2: a NEW status push AND the approval's retract, both in one tail.
	const allEvents: StreamEvent[] = [
		ev(1, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
		ev(2, { kind: "status", status: "custom-status" }),
		ev(3, {
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: "req_1",
			title: "Cancelled",
		}),
	];
	const afterBoth = foldIncremental(cursor, allEvents);

	expect(afterBoth).toEqual(foldEventsToTurns(allEvents));
	expect(afterBoth.map((t) => t.kind)).toEqual(["status"]);
});

it("retract-only tail (turns array shrinks) still publishes a fresh array reference", () => {
	const cursor = createFoldCursor();
	const afterPush = foldIncremental(cursor, [
		ev(1, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
	]);
	const allEvents: StreamEvent[] = [
		ev(1, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
		ev(2, {
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: "req_1",
			title: "Cancelled",
		}),
	];
	const afterRetract = foldIncremental(cursor, allEvents);

	expect(afterRetract).not.toBe(afterPush);
	expect(afterRetract).toEqual([]);
});

const chunkedScenarios: [string, StreamEvent[]][] = [
	["the general scenario", scenario],
	["an approval push+retract", approvalRetractEvents],
	[
		"a codex-style id-matched final replacing a streamed delta",
		codexFinalReplacesDeltaEvents,
	],
];

for (const [label, events] of chunkedScenarios) {
	it(`matches batch folding with randomized multi-event tails (1-4): ${label}`, () => {
		for (let seed = 1; seed <= 5; seed++) {
			const chunkSizes = randomChunkSizes(seed, events.length);
			expect(foldInChunks(events, chunkSizes)).toEqual(
				foldEventsToTurns(events)
			);
		}
	});
}
