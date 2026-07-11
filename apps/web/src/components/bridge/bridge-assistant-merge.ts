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
		tasksByCallId: new Map(),
		toolsByCallId: new Map(),
		touched: new Set(),
		turns: [],
	};
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
	state.turns.push(turn);
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
 * the trailing same-kind block" merge.
 */
export function accumulateOutput(
	state: FoldState,
	id: number,
	event: OutputEvent
): void {
	const kind: TextBlock["kind"] = event.reasoning ? "reasoning" : "text";
	if (event.id === undefined) {
		appendText(openAssistant(state, id).blocks, kind, event.text);
		return;
	}
	const existing = state.assistantByMessageId.get(event.id);
	if (existing) {
		existing.block.text += event.text;
		state.current = existing.turn;
		state.touched.add(existing.turn);
		return;
	}
	const turn = openAssistant(state, id);
	const block: TextBlock = { kind, text: event.text };
	turn.blocks.push(block);
	state.assistantByMessageId.set(event.id, { block, turn });
}

/**
 * Folds the FINAL assistant message for a turn. When `event.id` matches an
 * in-flight `accumulateOutput` block, the final text REPLACES it in place —
 * last-write-wins, never appended — so codex's `item.completed` (which
 * repeats the item's full text) collapses onto the same bubble its deltas
 * streamed into instead of opening a second one. Otherwise (no id, or an id
 * never seen before — claude-code/pi's single non-streamed messages) it opens
 * a brand-new bubble, exactly like the pre-id-contract behavior. Either way a
 * message is a turn boundary: it closes the open accumulation so trailing
 * id-less content starts a fresh bubble rather than appending here.
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
		state.current = null;
		state.touched.add(existing.turn);
		return;
	}
	const kind: TextBlock["kind"] = event.thinking ? "reasoning" : "text";
	const block: TextBlock = { kind, text: event.text };
	const turn: AssistantTurn = {
		blocks: [block],
		id,
		kind: "assistant",
		streaming: false,
	};
	if (event.id !== undefined) {
		state.assistantByMessageId.set(event.id, { block, turn });
	}
	state.turns.push(turn);
	state.current = null;
}
