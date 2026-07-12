// Split out of bridge-turns.ts purely to keep that file under the repo's
// 300-line limit (the whitelist-semantics fix on `foldStatus` pushed it over)
// — mirrors bridge-turns-tool-task.ts's identical split for the same gate.

import {
	type FoldState,
	pushTurn,
	removeTurns,
} from "./bridge-assistant-merge";
import type { ApprovalEvent, QuestionEvent } from "./bridge-events";

/**
 * RC-T3: an approval event stamped `cancelled: true` retracts a still-open
 * approval card (turn epoch superseded by an interrupt/stop — see
 * `apps/bridge-cli/src/adapters/approvals.ts`'s `retractPendingApprovals`)
 * instead of rendering as a new turn: the matching still-open card (by
 * `requestId`) is removed from the feed rather than left dangling for the
 * user to answer into a dead turn.
 */
export function foldApproval(
	state: FoldState,
	id: number,
	event: ApprovalEvent
): void {
	state.current = null;
	if (event.cancelled) {
		removeTurns(
			state,
			(turn) =>
				turn.kind === "approval" && turn.event.requestId === event.requestId
		);
		return;
	}
	pushTurn(state, { kind: "approval", id, event });
}

/**
 * R3-T3: mirrors `foldApproval` for opencode's `question.asked` — a
 * `cancelled: true` event retracts a still-open question card (by
 * `requestId`) instead of rendering as a new turn.
 */
export function foldQuestion(
	state: FoldState,
	id: number,
	event: QuestionEvent
): void {
	state.current = null;
	if (event.cancelled) {
		removeTurns(
			state,
			(turn) =>
				turn.kind === "question" && turn.event.requestId === event.requestId
		);
		return;
	}
	pushTurn(state, { kind: "question", id, event });
}
