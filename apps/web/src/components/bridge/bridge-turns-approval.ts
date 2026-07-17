// Split out of bridge-turns.ts purely to keep that file under the repo's
// 300-line limit — mirrors bridge-turns-tool-task.ts's identical split for
// the same gate.

import type {
	ApprovalBlockData,
	QuestionBlockData,
} from "@better-agent/ui/components/chat/chat-blocks";
import type { FoldState } from "./bridge-assistant-merge";
import type { ApprovalEvent, QuestionEvent } from "./bridge-events";
import { appendRequestBlock, removeRequestBlock } from "./bridge-request-block";

/**
 * Folds an approval request INTO the in-flight assistant turn as a block
 * (mirroring how a tool call folds in) — NOT as its own turn — so the request
 * card shares the message's avatar and spine, and the post-answer
 * continuation merges back into the same turn instead of opening a new one
 * (the old "card breaks the line, next reply shows a fresh avatar" problem).
 * `state.current` is deliberately left open: a request is mid-turn, not a
 * boundary.
 *
 * RC-T3: an approval event stamped `cancelled: true` retracts a still-open
 * approval block (turn epoch superseded by an interrupt/stop — see
 * `apps/bridge-cli/src/adapters/approvals.ts`'s `retractPendingApprovals`)
 * instead of rendering as a new block: the matching block (by `requestId`) is
 * removed from its turn rather than left dangling for the user to answer into
 * a dead request.
 */
function toApprovalBlock(event: ApprovalEvent): ApprovalBlockData {
	return {
		requestId: event.requestId,
		title: event.title,
		detail: event.detail,
		summary: event.summary,
		options: event.options,
		timeoutAt: event.timeoutAt,
		timeoutMs: event.timeoutMs,
	};
}

export function foldApproval(
	state: FoldState,
	id: number,
	event: ApprovalEvent
): void {
	if (event.cancelled) {
		removeRequestBlock(state, event.requestId);
		return;
	}
	// fix-approval-replay: a resolution event (the CLI's persisted "this was
	// answered with X" marker) is consumed by the feed's answered map
	// (use-bridge-feed.ts), which the ORIGINAL card reads its answered state
	// from — it must never render as a fresh card of its own.
	if (event.answeredOptionId !== undefined) {
		return;
	}
	appendRequestBlock(state, id, {
		kind: "approval",
		approval: toApprovalBlock(event),
	});
}

/**
 * R3-T3: mirrors `foldApproval` for opencode's `question.asked` — folds INTO
 * the assistant turn as a block, and a `cancelled: true` event retracts a
 * still-open question block (by `requestId`) instead of rendering as a new
 * one.
 */
function toQuestionBlock(event: QuestionEvent): QuestionBlockData {
	return {
		requestId: event.requestId,
		title: event.title,
		questions: event.questions,
	};
}

export function foldQuestion(
	state: FoldState,
	id: number,
	event: QuestionEvent
): void {
	if (event.cancelled) {
		removeRequestBlock(state, event.requestId);
		return;
	}
	appendRequestBlock(state, id, {
		kind: "question",
		question: toQuestionBlock(event),
	});
}
