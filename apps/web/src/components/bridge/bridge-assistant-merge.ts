// The streaming/terminal id contract: a delta (`OutputEvent`) and the final
// message (`MessageEvent`) for the SAME logical assistant message share a
// stable id (see `apps/bridge-cli/src/normalize/codex.ts`). This module folds
// that contract into `bridge-turns.ts`'s `FoldState` — one bubble per id,
// last-write-wins on the final — the same way `foldTool` already merges by
// `event.id` for tool calls. Fixes the reported "codex repeats every output"
// bug: codex's normalize emits BOTH a streamed delta and a final message for
// one item; before this, `foldMessage` always opened a second bubble for the
// final because it had no way to tell it was the same message.

import {
	appendText,
	type ChatBlock,
	type ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";
import type { MessageEvent, OutputEvent } from "./bridge-events";
import type {
	AssistantTurn,
	BridgeTurn,
	PlanTurn,
	TaskTurn,
} from "./bridge-turn-types";

type TextBlock = Extract<ChatBlock, { kind: "text" | "reasoning" }>;

/** Ties a streaming message id to the specific block it writes into, so a
 * later delta or the eventual final for the SAME id finds its way back to
 * that exact block — even if other blocks (an interleaved tool call) were
 * appended in between — instead of spawning a second bubble. */
export interface MessageAccumulator {
	block: TextBlock;
	/** Set by `finalizeAssistantMessage` once the final for this id has landed
	 * — the accumulator entry is kept around (so a REPEATED final, or the
	 * id-matched lookup itself, still resolves) but is now closed to further
	 * accumulation. Per the last-write-wins contract (see `FoldState.current`'s
	 * doc), the final IS canonical: a late/duplicate `output` delta that still
	 * carries this id afterward is a network straggler, not new content — see
	 * `accumulateOutput`, which drops it rather than appending onto the sealed
	 * text. */
	sealed: boolean;
	turn: AssistantTurn;
}

/** A tool call plus the assistant turn its block lives in — lets a later
 * update (completed/failed) that mutates `tool` in place also mark the
 * OWNING turn as touched (see `FoldState.touched`), even though the turn
 * itself isn't otherwise re-visited. */
export interface ToolOwner {
	tool: ToolInvocation;
	turn: AssistantTurn;
}

export interface FoldState {
	/** In-flight streamed messages keyed by their shared id — see
	 * `MessageAccumulator`. */
	assistantByMessageId: Map<string, MessageAccumulator>;
	current: AssistantTurn | null;
	/** The single plan/todo turn, updated in place as `plan` updates arrive. */
	plan: PlanTurn | null;
	/** Pending approval/question request blocks keyed by requestId — lets a
	 * `cancelled` retract find and remove the exact block now that requests
	 * fold INTO an assistant turn as blocks (not their own turns). Maps to the
	 * CANONICAL owning turn (a `state.turns` entry), never a published clone. */
	requestsByRequestId: Map<string, { turn: AssistantTurn }>;
	/** The block a FINALIZED message last wrote into (see
	 * `finalizeAssistantMessage`) — a "sealed" marker, not a turn boundary. A
	 * later id-less `accumulateOutput` delta checks this: if it's about to
	 * land on the SAME block, it must open a fresh block instead of appending
	 * (via `appendText`'s trailing-same-kind merge), or it would silently glue
	 * unrelated new text onto content the final message already committed.
	 * Anything else — a new block, a new turn — naturally stops matching this
	 * reference, so no explicit clearing is needed elsewhere. */
	sealedBlock: TextBlock | null;
	/** Set whenever `turns` gained or lost an ELEMENT this pass (a push or a
	 * retract) — as opposed to `touched`, which tracks in-place mutation of
	 * existing elements. Consulted only by the incremental fold core
	 * (fold-cursor.ts): it used to infer this from `turns.length` before vs.
	 * after, which breaks the moment a push and a retract land in the SAME
	 * pass (the net length delta cancels to zero even though the array's
	 * CONTENTS changed) — see `pushTurn`/`removeTurns`, the only two places
	 * that mutate `turns` and thus the only two places allowed to set this. */
	structureChanged: boolean;
	tasksByCallId: Map<string, TaskTurn>;
	toolsByCallId: Map<string, ToolOwner>;
	/** Turns mutated IN PLACE during the current incremental fold pass (a
	 * block's text grew, a tool/task completed, the plan's items changed, the
	 * streaming caret moved) — consulted only by the incremental fold core
	 * (fold-cursor.ts) to know which turns need a fresh top-level reference
	 * for `React.memo` to see; `foldEventsToTurns` populates it too (every
	 * mutation site marks it unconditionally) but never reads it. */
	touched: Set<BridgeTurn>;
	turns: BridgeTurn[];
}

/** A fresh, empty fold accumulator — the single source of truth for both
 * `foldEventsToTurns` (one-shot batch) and the incremental engine
 * (fold-cursor.ts), so the two can never diverge in how an event folds. */
export function createFoldState(): FoldState {
	return {
		assistantByMessageId: new Map(),
		current: null,
		plan: null,
		requestsByRequestId: new Map(),
		sealedBlock: null,
		structureChanged: false,
		tasksByCallId: new Map(),
		toolsByCallId: new Map(),
		touched: new Set(),
		turns: [],
	};
}

/** The ONLY place allowed to append to `state.turns` — every call site in
 * this module and bridge-turns.ts routes through here (instead of calling
 * `.push` directly) so `structureChanged` can never be forgotten at a new
 * call site. */
export function pushTurn(state: FoldState, turn: BridgeTurn): void {
	state.turns.push(turn);
	state.structureChanged = true;
}

/** The ONLY place allowed to remove elements from `state.turns` — mirrors
 * `pushTurn`. Only marks `structureChanged` when something was actually
 * removed, so a no-op retract (a requestId that's already gone) doesn't
 * force an unnecessary rebuild. */
export function removeTurns(
	state: FoldState,
	predicate: (turn: BridgeTurn) => boolean
): void {
	const before = state.turns.length;
	state.turns = state.turns.filter((turn) => !predicate(turn));
	if (state.turns.length !== before) {
		state.structureChanged = true;
	}
}

/** Reuse the open assistant turn, or start (and record) a fresh one. Either
 * way the returned turn is about to receive a new/updated block from the
 * caller, so it's marked touched here — the one place all block-writing
 * paths pass through. */
export function openAssistant(state: FoldState, id: number): AssistantTurn {
	if (state.current) {
		state.touched.add(state.current);
		return state.current;
	}
	const turn: AssistantTurn = {
		kind: "assistant",
		id,
		blocks: [],
		streaming: false,
	};
	pushTurn(state, turn);
	state.current = turn;
	state.touched.add(turn);
	return turn;
}

/**
 * Folds one streaming `output` delta into its assistant bubble. A delta that
 * carries a message id (codex's item id, …) accumulates into the SAME block
 * across the whole turn via `assistantByMessageId` — the id half of the
 * contract that lets the eventual final message replace it in place instead
 * of rendering a second bubble (see `finalizeAssistantMessage`). An id-less
 * delta (claude-code, pi, opencode ACP chunks — adapters that never repeat
 * this content in a final message) falls back to the pre-existing "append to
 * the trailing same-kind block" merge — UNLESS the trailing block is
 * `state.sealedBlock` (a message just finalized into it): that block is done
 * accumulating, so a delta landing right after it opens a fresh block in the
 * SAME turn instead of silently growing already-committed text.
 */
export function accumulateOutput(
	state: FoldState,
	id: number,
	event: OutputEvent
): void {
	const kind: TextBlock["kind"] = event.reasoning ? "reasoning" : "text";
	if (event.id === undefined) {
		const turn = openAssistant(state, id);
		if (turn.blocks.at(-1) === state.sealedBlock) {
			turn.blocks.push({ kind, text: event.text });
		} else {
			appendText(turn.blocks, kind, event.text);
		}
		return;
	}
	const existing = state.assistantByMessageId.get(event.id);
	if (existing) {
		// The final for this id already landed (see `finalizeAssistantMessage`)
		// — per last-write-wins, that final IS canonical, so this delta is a
		// late/duplicate straggler. Drop it: don't append onto the sealed text,
		// don't touch `state.current`, and don't mark the turn touched (it did
		// not change) — see `MessageAccumulator.sealed`'s doc.
		if (existing.sealed) {
			return;
		}
		existing.block.text += event.text;
		state.current = existing.turn;
		state.touched.add(existing.turn);
		return;
	}
	const turn = openAssistant(state, id);
	const block: TextBlock = { kind, text: event.text };
	turn.blocks.push(block);
	state.assistantByMessageId.set(event.id, { block, sealed: false, turn });
}

/**
 * Folds the FINAL assistant message for a turn. When `event.id` matches an
 * in-flight `accumulateOutput` block, the final text REPLACES it in place —
 * last-write-wins, never appended — so codex's `item.completed` (which
 * repeats the item's full text) collapses onto the same bubble its deltas
 * streamed into instead of opening a second one. Otherwise (no id, or an id
 * never seen before — pi/opencode's single non-streamed messages) it opens a
 * NEW block, reusing the open turn (`state.current`) if there is one instead
 * of always starting a fresh turn — exactly like `foldTool` already does.
 *
 * Unlike the old behavior, a message final is NOT a turn boundary by itself:
 * `state.current` stays set to this turn (see `FoldState.current`'s doc) so a
 * following tool call folds into the SAME turn rather than opening a new one
 * (the "text→tool→text fragments into three turns" bug). Only the text
 * ACCUMULATION closes — the finalized block is marked `state.sealedBlock` so
 * a trailing id-less delta opens a fresh block instead of appending onto
 * already-committed text (see `accumulateOutput`).
 *
 * ASSUMPTION: a message id's `reasoning`/`thinking` flag doesn't change
 * between its deltas and its final — true for every adapter today (codex
 * never flags a delta as reasoning at all). If that ever changes, the final
 * keeps the ORIGINAL block's kind rather than retagging it.
 */
export function finalizeAssistantMessage(
	state: FoldState,
	id: number,
	event: MessageEvent
): void {
	const existing =
		event.id === undefined
			? undefined
			: state.assistantByMessageId.get(event.id);
	if (existing) {
		existing.block.text = event.text;
		existing.sealed = true;
		state.current = existing.turn;
		state.sealedBlock = existing.block;
		state.touched.add(existing.turn);
		return;
	}
	const kind: TextBlock["kind"] = event.thinking ? "reasoning" : "text";
	const turn = openAssistant(state, id);
	const block: TextBlock = { kind, text: event.text };
	turn.blocks.push(block);
	if (event.id !== undefined) {
		state.assistantByMessageId.set(event.id, { block, sealed: true, turn });
	}
	state.sealedBlock = block;
}
