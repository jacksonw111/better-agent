// Split out of bridge-assistant-merge.ts purely to keep that file under the
// repo's 300-line cap — these helpers fold an approval/question request INTO
// an assistant turn as a block (and retract it), the request-specific half of
// the merge module. They take the shared `FoldState` and route through
// `openAssistant`/`removeTurns` like every other block-writing path.

import type { ChatBlock } from "@better-agent/ui/components/chat/chat-blocks";
import {
	type FoldState,
	openAssistant,
	removeTurns,
} from "./bridge-assistant-merge";
import type { AssistantTurn } from "./bridge-turn-types";

/** The requestId of an `approval`/`question` block, else `undefined`. */
function requestBlockId(block: ChatBlock): string | undefined {
	if (block.kind === "approval") {
		return block.approval.requestId;
	}
	if (block.kind === "question") {
		return block.question.requestId;
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** Folds a pending approval/question request INTO the in-flight assistant
 * turn as a block (mirroring how a tool call folds in) — NOT as its own turn
 * — so the request shares the message's avatar and spine and the post-answer
 * continuation merges into the same turn instead of opening a new one.
 * `openAssistant` ensures a turn exists (a request can arrive with no
 * preceding text). The block is recorded by requestId so a later `cancelled`
 * retract can remove it. */
export function appendRequestBlock(
	state: FoldState,
	id: number,
	block: Extract<ChatBlock, { kind: "approval" | "question" }>
): AssistantTurn {
	const turn = openAssistant(state, id);
	turn.blocks.push(block);
	const requestId = requestBlockId(block);
	if (requestId !== undefined) {
		state.requestsByRequestId.set(requestId, { turn });
	}
	return turn;
}

/** Removes a still-open approval/question block (a `cancelled` retract) from
 * whichever assistant turn embedded it. If the turn is left empty it is
 * dropped entirely (and cleared as `current` if it was the streaming one) so
 * no empty bubble is left behind; otherwise the turn is marked touched so the
 * incremental fold publishes a fresh clone (a bare in-place `blocks` mutation
 * would not change the turn reference `React.memo` shallow-compares on). */
export function removeRequestBlock(state: FoldState, requestId: string): void {
	const owner = state.requestsByRequestId.get(requestId);
	if (owner === undefined) {
		return;
	}
	state.requestsByRequestId.delete(requestId);
	const { turn } = owner;
	const before = turn.blocks.length;
	turn.blocks = turn.blocks.filter(
		(block) => requestBlockId(block) !== requestId
	);
	if (turn.blocks.length === before) {
		return;
	}
	if (turn.blocks.length === 0) {
		removeTurns(state, (candidate) => candidate === turn);
		if (state.current === turn) {
			state.current = null;
		}
		return;
	}
	state.touched.add(turn);
}
