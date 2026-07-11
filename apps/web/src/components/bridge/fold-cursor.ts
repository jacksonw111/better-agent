import { createFoldState, type FoldState } from "./bridge-assistant-merge";
import type { StreamEvent } from "./bridge-events";
import type { AssistantTurn, BridgeTurn } from "./bridge-turn-types";
import { foldEvent } from "./bridge-turns";

// R0-T4: incremental fold core. `foldEventsToTurns` (bridge-turns.ts) re-folds
// the WHOLE event array every call — fine for a one-shot batch, but the web
// terminal called it from a `useMemo` keyed on `bridge.events`, so every
// streamed token re-ran the entire session's fold logic (O(n²) total over a
// long session). `foldIncremental` folds ONLY the events appended since the
// last call, reusing the same `foldEvent` core (bridge-turns.ts) so the two
// paths can never diverge in behavior — see bridge-turns.test.ts et al,
// which pin `foldEventsToTurns`'s output and must keep passing unmodified.

/** Persistent incremental-fold accumulator — one per terminal session, kept
 * in a ref by `useFoldedTurns` (use-folded-turns.ts) across renders. */
export interface FoldCursor {
	/** How many leading events of the array have already been folded into
	 * `state`; the next call folds only `events.slice(foldedCount)`. */
	foldedCount: number;
	/** id of `events[foldedCount - 1]` as of the last fold — part of reset
	 * detection (see `needsReset`). */
	lastBoundaryId: number | undefined;
	/** id of `events[0]` as of the last fold. */
	lastFirstId: number | undefined;
	/** The last `turns` array handed out — returned again unchanged when a
	 * call folds nothing new, so `useMemo`-style callers can skip re-render. */
	lastOutput: BridgeTurn[];
	/** Total individual events ever folded — monotonically increasing,
	 * exposed for perf-sanity assertions (folding stays proportional to NEW
	 * events, never the whole history). */
	processedEvents: number;
	/** canonical (mutable) turn -> the last cloned/published snapshot handed
	 * to a caller for it, so an UNCHANGED turn keeps returning the exact same
	 * reference across calls even after it was cloned once (identity
	 * stability for `React.memo`). */
	published: Map<BridgeTurn, BridgeTurn>;
	state: FoldState;
}

export function createFoldCursor(): FoldCursor {
	return {
		foldedCount: 0,
		lastBoundaryId: undefined,
		lastFirstId: undefined,
		lastOutput: [],
		processedEvents: 0,
		published: new Map(),
		state: createFoldState(),
	};
}

/** True when `events` isn't a pure extension of what's already folded: a
 * history reload/session switch replaces the array outright (shorter, or a
 * different leading id), and a mid-array splice — e.g. `use-bridge-feed.ts`'s
 * `stripAckedEchoes` dropping an already-folded optimistic echo once its
 * server twin arrives — shifts everything after it even though the array's
 * length and first id can both stay unchanged. The boundary-id check (the id
 * at the OLD `foldedCount - 1` position) catches that last case: a splice
 * anywhere at or before that index changes what sits there. */
function needsReset(cursor: FoldCursor, events: StreamEvent[]): boolean {
	if (cursor.foldedCount === 0) {
		return false;
	}
	if (events.length < cursor.foldedCount) {
		return true;
	}
	if (events[0]?.id !== cursor.lastFirstId) {
		return true;
	}
	return events[cursor.foldedCount - 1]?.id !== cursor.lastBoundaryId;
}

function resetCursor(cursor: FoldCursor): void {
	cursor.state = createFoldState();
	cursor.foldedCount = 0;
	cursor.lastFirstId = undefined;
	cursor.lastBoundaryId = undefined;
	cursor.published = new Map();
	cursor.lastOutput = [];
}

function cloneTurn(turn: BridgeTurn): BridgeTurn {
	if (turn.kind === "assistant") {
		return { ...turn, blocks: [...turn.blocks] };
	}
	return { ...turn };
}

/** Mirrors `foldEventsToTurns`'s end-of-batch `state.current.streaming = true`
 * step, but incrementally: the turn that WAS the trailing open one (if any)
 * stops streaming the moment it's no longer `state.current`, and whichever
 * turn IS current at the end of this pass starts streaming — at most one
 * turn is ever marked, matching the batch semantics exactly. */
function finalizeStreaming(
	state: FoldState,
	previousCurrent: AssistantTurn | null
): void {
	if (
		previousCurrent &&
		previousCurrent !== state.current &&
		previousCurrent.streaming
	) {
		previousCurrent.streaming = false;
		state.touched.add(previousCurrent);
	}
	if (state.current && !state.current.streaming) {
		state.current.streaming = true;
		state.touched.add(state.current);
	}
}

/** Builds the output array: a touched turn gets a FRESH clone (derived from
 * its current, canonical, ever-mutating state — never from a stale prior
 * clone), an untouched-but-previously-cloned turn reuses whatever was last
 * published for it, and everything else passes through as-is. Skips the
 * whole pass (same array reference) when nothing rendering-relevant
 * happened this call. */
function publish(cursor: FoldCursor, turnsCountChanged: boolean): BridgeTurn[] {
	const { state, published } = cursor;
	if (!turnsCountChanged && state.touched.size === 0) {
		return cursor.lastOutput;
	}
	const output = state.turns.map((turn) => {
		if (state.touched.has(turn)) {
			const clone = cloneTurn(turn);
			published.set(turn, clone);
			return clone;
		}
		return published.get(turn) ?? turn;
	});
	cursor.lastOutput = output;
	return output;
}

/**
 * Folds `events` into `cursor`, returning the renderable turns. Resets and
 * refolds everything when `events` isn't a superset extension of what's
 * already folded (see `needsReset`); otherwise folds only the new tail.
 * Returns the SAME array reference as the previous call when nothing new
 * folded into a visible change (a hidden heartbeat, or simply no new
 * events) — the reference changes exactly when a turn was added, removed, or
 * mutated in place, so `React.memo`'d rows can skip re-rendering.
 */
export function foldIncremental(
	cursor: FoldCursor,
	events: StreamEvent[]
): BridgeTurn[] {
	if (needsReset(cursor, events)) {
		resetCursor(cursor);
	}
	const tail = events.slice(cursor.foldedCount);
	if (tail.length === 0) {
		return cursor.lastOutput;
	}
	const { state } = cursor;
	const turnsBefore = state.turns.length;
	const previousCurrent = state.current;
	state.touched.clear();
	for (const { id, event } of tail) {
		foldEvent(state, id, event);
		cursor.processedEvents += 1;
	}
	finalizeStreaming(state, previousCurrent);
	cursor.foldedCount = events.length;
	cursor.lastFirstId = events[0]?.id;
	cursor.lastBoundaryId = events.at(-1)?.id;
	return publish(cursor, state.turns.length !== turnsBefore);
}
