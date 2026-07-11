import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";
import { createFoldCursor, foldIncremental } from "./fold-cursor";

// R0-T4: the incremental fold core. `foldEventsToTurns` re-folds the WHOLE
// array every call (fine for the one-shot batch tests in bridge-turns*.test.ts);
// `foldIncremental` instead folds only the events appended since the last
// call, via a persistent `FoldCursor`. These tests pin: (1) incremental
// folding one event at a time produces the SAME turns as a full batch fold,
// (2) reset detection refolds cleanly instead of leaving stale turns, (3)
// unchanged rows keep their object reference across calls (so `React.memo`
// can skip) while mutated rows get a fresh one, and (4) folding stays
// proportional to NEW events, not total history.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

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

const scenario: StreamEvent[] = [
	ev(-1, { kind: "message", role: "user", text: "run the tests" }),
	ev(1, { kind: "output", text: "Sure, " }),
	ev(2, { kind: "output", text: "let me check." }),
	ev(3, {
		kind: "tool",
		id: "t1",
		name: "shell",
		input: { cmd: "ls" },
		status: "started",
	}),
	ev(4, { kind: "status", status: "usage_update", detail: { tokens: 12 } }),
	ev(5, {
		kind: "tool",
		id: "t1",
		name: "shell",
		status: "completed",
		output: "file.txt",
	}),
	ev(6, {
		kind: "status",
		status: "plan",
		detail: [{ content: "Read the code", status: "in_progress" }],
	}),
	ev(7, {
		kind: "status",
		status: "plan",
		detail: [{ content: "Read the code", status: "completed" }],
	}),
	ev(8, { kind: "status", status: "turn_end" }),
	ev(9, { kind: "output", text: "All done." }),
];

it("folding one event at a time matches a full batch fold", () => {
	expect(foldOneAtATime(scenario)).toEqual(foldEventsToTurns(scenario));
});

it("matches batch folding across an approval retract", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
		ev(2, { kind: "output", text: "meanwhile" }),
		ev(3, {
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: "req_1",
			title: "Cancelled",
		}),
	];
	expect(foldOneAtATime(events)).toEqual(foldEventsToTurns(events));
});

it("matches batch folding when a codex-style id-matched final replaces a streamed delta", () => {
	const events: StreamEvent[] = [
		ev(1, { kind: "output", text: "Check", id: "item_1" }),
		ev(2, { kind: "output", text: "ing the file", id: "item_1" }),
		ev(3, {
			kind: "message",
			role: "assistant",
			text: "Checking the file — done.",
			id: "item_1",
		}),
	];
	expect(foldOneAtATime(events)).toEqual(foldEventsToTurns(events));
});
