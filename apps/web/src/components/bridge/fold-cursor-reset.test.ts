import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";
import { createFoldCursor, foldIncremental } from "./fold-cursor";

// Reset-detection coverage for fold-cursor.ts — split out of
// fold-cursor.test.ts to stay under the repo's 300-line file cap.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("refolds cleanly when the array shrinks (no stale turns left behind)", () => {
	const cursor = createFoldCursor();
	const full = [
		ev(1, { kind: "output", text: "one" }),
		ev(2, { kind: "output", text: "two" }),
		ev(3, { kind: "status", status: "turn_end" }),
	];
	foldIncremental(cursor, full);
	// A history reload replaces the array with a shorter, unrelated one.
	const shorter = [ev(1, { kind: "output", text: "restarted" })];
	const turns = foldIncremental(cursor, shorter);
	expect(turns).toEqual(foldEventsToTurns(shorter));
});

it("refolds cleanly when the leading event's id changes (session switch)", () => {
	const cursor = createFoldCursor();
	const sessionA = [
		ev(1, { kind: "output", text: "session A" }),
		ev(2, { kind: "status", status: "turn_end" }),
	];
	foldIncremental(cursor, sessionA);
	// Same length, but a totally different session's events (fresh ids).
	const sessionB = [
		ev(101, { kind: "output", text: "session B" }),
		ev(102, { kind: "status", status: "turn_end" }),
	];
	const turns = foldIncremental(cursor, sessionB);
	expect(turns).toEqual(foldEventsToTurns(sessionB));
});

// This mirrors use-bridge-feed.ts's `stripAckedEchoes`: an optimistic local
// echo (already folded into a "user" turn) sits in the MIDDLE of the array;
// once the server's persisted twin arrives, the echo is spliced out and the
// twin appended — length and first id can both stay the same (or even grow),
// so only the boundary-id check catches it. Without a reset here, the
// incremental fold would keep the stale echo's "user" turn AND fold the new
// server twin into a second one — a duplicated user bubble.
it("refolds when a mid-array splice leaves length and first id unchanged", () => {
	const cursor = createFoldCursor();
	const withEcho = [
		ev(-1, { kind: "message", role: "user", text: "hello agent" }),
		ev(1, { kind: "output", text: "thinking…" }),
	];
	foldIncremental(cursor, withEcho);

	const spliced = [
		ev(1, { kind: "output", text: "thinking…" }),
		ev(2, { kind: "message", role: "user", text: "hello agent" }),
	];
	const turns = foldIncremental(cursor, spliced);
	expect(turns).toEqual(foldEventsToTurns(spliced));
	expect(turns.filter((t) => t.kind === "user")).toHaveLength(1);
});
