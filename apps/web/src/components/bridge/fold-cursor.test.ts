import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";
import { createFoldCursor, foldIncremental } from "./fold-cursor";
import {
	approvalRetractEvents,
	codexFinalReplacesDeltaEvents,
	scenario,
} from "./fold-cursor-fixtures";

// R0-T4: the incremental fold core. `foldEventsToTurns` re-folds the WHOLE
// array every call (fine for the one-shot batch tests in bridge-turns*.test.ts);
// `foldIncremental` instead folds only the events appended since the last
// call, via a persistent `FoldCursor`. These tests pin: (1) incremental
// folding one event at a time produces the SAME turns as a full batch fold,
// (2) reset detection refolds cleanly instead of leaving stale turns, (3)
// unchanged rows keep their object reference across calls (so `React.memo`
// can skip) while mutated rows get a fresh one, and (4) folding stays
// proportional to NEW events, not total history. The event sequences below
// live in fold-cursor-fixtures.ts so fold-cursor-structure.test.ts can re-run
// them with randomized multi-event tails instead of one event at a time.

/** Folds `events` one at a time through a fresh cursor — the property under
 * test is that this equals a single batch `foldEventsToTurns(events)` call. */
function foldOneAtATime(events: StreamEvent[]) {
	const cursor = createFoldCursor();
	let turns = foldIncremental(cursor, []);
	for (let i = 1; i <= events.length; i++) {
		turns = foldIncremental(cursor, events.slice(0, i));
	}
	return turns;
}

it("folding one event at a time matches a full batch fold", () => {
	expect(foldOneAtATime(scenario)).toEqual(foldEventsToTurns(scenario));
});

it("matches batch folding across an approval retract", () => {
	expect(foldOneAtATime(approvalRetractEvents)).toEqual(
		foldEventsToTurns(approvalRetractEvents)
	);
});

it("matches batch folding when a codex-style id-matched final replaces a streamed delta", () => {
	expect(foldOneAtATime(codexFinalReplacesDeltaEvents)).toEqual(
		foldEventsToTurns(codexFinalReplacesDeltaEvents)
	);
});
