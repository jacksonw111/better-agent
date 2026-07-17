import type { StreamEvent } from "./bridge-events";

// fix-approval-replay / fix-question-replay: the pure folds that reconstruct
// "this request was already answered" from the CLI's persisted RESOLUTION
// events. An answer itself only ever travels as a relay COMMAND (a TTL'd
// rolling window, never persisted), so on the tail of every merge these fold
// the resolution markers into the answered maps — seed history / live / poll
// alike. Split out of use-bridge-feed.ts purely to keep that file under the
// repo's 300-line cap.

/** Folds approval RESOLUTION events (kind "approval" + `answeredOptionId` —
 * the CLI's persisted "this was answered with X" marker, see
 * apps/bridge-cli/src/adapters/approvals.ts) from the newly-merged tail into
 * the answered map, so a reload/replay reconstructs the answered state without
 * relying on the relay's TTL'd commands window. Returns the SAME object when
 * the batch carries none (the common case, allocation-free). */
export function nextAnsweredApprovals(
	prev: Record<string, string>,
	parsed: StreamEvent[]
): Record<string, string> {
	let answered = prev;
	for (const { event } of parsed) {
		if (event.kind !== "approval" || event.answeredOptionId === undefined) {
			continue;
		}
		if (answered === prev) {
			answered = { ...prev };
		}
		answered[event.requestId] = event.answeredOptionId;
	}
	return answered;
}

/** Mirrors `nextAnsweredApprovals` for question RESOLUTION events (kind
 * "question" + `answeredAnswers`, see
 * apps/bridge-cli/src/adapters/questions.ts) — folds them into the
 * answeredQuestions map with the same allocation-free common case. */
export function nextAnsweredQuestions(
	prev: Record<string, string[][]>,
	parsed: StreamEvent[]
): Record<string, string[][]> {
	let answered = prev;
	for (const { event } of parsed) {
		if (event.kind !== "question" || event.answeredAnswers === undefined) {
			continue;
		}
		if (answered === prev) {
			answered = { ...prev };
		}
		answered[event.requestId] = event.answeredAnswers;
	}
	return answered;
}
