// R3-T3: a pending-question registry, parallel to approvals.ts's
// ApprovalRegistry — kept SEPARATE (not folded into ApprovalRegistry) because
// a question's reply is `string[][]` (one array of chosen labels per
// question) rather than a single `optionId`, and opencode's `question.asked`
// is its own SSE event family, distinct from `permission.updated`.

import type { NormalizedEvent, QuestionEvent } from "../normalize/types";
import { APPROVAL_TIMEOUT_MS } from "./approvals";

/** Status emitted in place of a reply when `answer()` is called with a
 * `requestId` that was never registered, or was already answered/retracted —
 * mirrors approvals.ts's `APPROVAL_UNKNOWN_STATUS`. */
const QUESTION_UNKNOWN_STATUS = "question_unknown";

interface PendingQuestion {
	reply(answers: string[][]): void;
	timer?: ReturnType<typeof setTimeout>;
}

export interface QuestionRegistry {
	/** Looks up `requestId` and invokes its reply function with `answers`,
	 * removing it from the registry so a duplicate `answer()` call for the
	 * same id is a no-op. An unknown id emits a `status` warning instead of
	 * throwing. */
	answer(requestId: string, answers: string[][]): void;
	/** Drops every still-pending reply function — call once the agent process
	 * has exited. */
	clear(): void;
	/** Registers `reply` to be invoked (at most once) by a matching
	 * `answer()`. `timer` is the fail-closed timer `presentQuestion` armed for
	 * this question, if any, so `retract`/`retractAll`/`answer` can clear it. */
	register(
		requestId: string,
		reply: (answers: string[][]) => void,
		timer?: ReturnType<typeof setTimeout>
	): void;
	/** Drops `requestId`'s pending reply WITHOUT invoking it. Returns whether
	 * an entry was actually removed. */
	retract(requestId: string): boolean;
	/** Drops every still-pending reply WITHOUT invoking it. Returns the
	 * requestIds that were pending. */
	retractAll(): string[];
}

/** `answer()`'s implementation, pulled out of `createQuestionRegistry`'s
 * returned object literal so that function stays under this file's
 * max-lines-per-function lint gate — mirrors approvals.ts's `answerPending`. */
function answerPendingQuestion(
	pending: Map<string, PendingQuestion>,
	events: { push(event: NormalizedEvent): void },
	requestId: string,
	answers: string[][]
): void {
	const entry = pending.get(requestId);
	if (!entry) {
		events.push({
			kind: "status",
			status: QUESTION_UNKNOWN_STATUS,
			detail: { requestId },
		});
		return;
	}
	pending.delete(requestId);
	clearTimeout(entry.timer);
	// fix-question-replay: persist the fact this question WAS answered —
	// mirrors approvals.ts's `answerPending`. The answer command itself
	// only lives in the relay's TTL'd commands window, so this resolution
	// event — pushed (and persisted to bridge_messages) like any other —
	// is what lets a later reload/replay reconstruct the answered state.
	// Pushed BEFORE the reply so it always precedes the turn's
	// continuation events.
	events.push({
		kind: "question",
		answeredAnswers: answers,
		questions: [],
		requestId,
		title: "Answered",
	});
	entry.reply(answers);
}

export function createQuestionRegistry(events: {
	push(event: NormalizedEvent): void;
}): QuestionRegistry {
	const pending = new Map<string, PendingQuestion>();
	return {
		register(requestId, reply, timer) {
			pending.set(requestId, { reply, timer });
		},
		answer(requestId, answers) {
			answerPendingQuestion(pending, events, requestId, answers);
		},
		clear() {
			pending.clear();
		},
		retract(requestId) {
			const entry = pending.get(requestId);
			if (!entry) {
				return false;
			}
			pending.delete(requestId);
			clearTimeout(entry.timer);
			return true;
		},
		retractAll() {
			const requestIds = [...pending.keys()];
			for (const entry of pending.values()) {
				clearTimeout(entry.timer);
			}
			pending.clear();
			return requestIds;
		},
	};
}

/**
 * RC-T3-style: retracts every pending question on `questions` and pushes a
 * cancelled `QuestionEvent` for each so the web removes the still-open card —
 * mirrors approvals.ts's `retractPendingApprovals`, called from the same
 * interrupt/stop paths.
 */
export function retractPendingQuestions(
	questions: QuestionRegistry,
	events: { push(event: NormalizedEvent): void }
): void {
	for (const requestId of questions.retractAll()) {
		events.push({
			cancelled: true,
			kind: "question",
			questions: [],
			requestId,
			title: "Cancelled",
		});
	}
}

/**
 * R3-T3: mirrors approvals.ts's `presentApproval` fail-closed timeout
 * contract for questions — reuses the same `APPROVAL_TIMEOUT_MS` window.
 * Registers `onAnswer` with the registry, pushes `event` (the card) onto
 * `events`, and arms a timer; if it fires before an answer arrives,
 * `questions.retract` (only succeeds if nothing already claimed this id)
 * pushes a visible "timed out — declined" event and calls `onTimeout`.
 * R3-4 review finding 4: the pushed card is also stamped with `timeoutMs` —
 * mirrors `presentApproval`'s own stamping, see that doc comment for why.
 */
export interface PresentQuestionOptions {
	event: QuestionEvent;
	events: { push(event: NormalizedEvent): void };
	onAnswer: (answers: string[][]) => void;
	onTimeout: () => void;
	questions: QuestionRegistry;
}

export function presentQuestion(options: PresentQuestionOptions): void {
	const { events, event, onAnswer, onTimeout, questions } = options;
	const timeoutAt = Date.now() + APPROVAL_TIMEOUT_MS;
	const timer = setTimeout(() => {
		if (!questions.retract(event.requestId)) {
			return;
		}
		events.push({
			cancelled: true,
			kind: "question",
			questions: [],
			requestId: event.requestId,
			title: "Timed out — declined",
		});
		onTimeout();
	}, APPROVAL_TIMEOUT_MS);

	questions.register(
		event.requestId,
		(answers) => {
			clearTimeout(timer);
			onAnswer(answers);
		},
		timer
	);
	events.push({ ...event, timeoutAt, timeoutMs: APPROVAL_TIMEOUT_MS });
}
