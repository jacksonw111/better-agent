// R3-T3: the `answerQuestion` control command's type + parser — split out of
// commands.ts purely to keep that file under the repo's 300-line file cap
// (same precedent as command-dispatch.ts's own header comment).

/** The web's reply to a `question` event (opencode's `question.asked`) — one
 * chosen answer array per question, in the same order as the originating
 * `QuestionEvent.questions`. An EMPTY `answers` array means "reject" (see
 * `CommandSink.answerQuestion`'s doc comment, commands.ts). Routed to
 * `CommandSink.answerQuestion`. */
export interface ControlAnswerQuestionCommand {
	action: "answerQuestion";
	answers: string[][];
	requestId: string;
	type: "control";
}

function isStringArrayArray(value: unknown): value is string[][] {
	return (
		Array.isArray(value) &&
		value.every(
			(item) => Array.isArray(item) && item.every((s) => typeof s === "string")
		)
	);
}

/** `{ action: "answerQuestion", requestId, answers }` — its own function
 * (not folded into commands.ts's `parseControlCommandWithPayload`) since
 * `answers` needs a nested-array check, not a plain `typeof === "string"`
 * one. */
export function parseAnswerQuestionCommand(
	data: Record<string, unknown>
): ControlAnswerQuestionCommand | null {
	if (
		data.action === "answerQuestion" &&
		typeof data.requestId === "string" &&
		isStringArrayArray(data.answers)
	) {
		return {
			action: "answerQuestion",
			answers: data.answers,
			requestId: data.requestId,
			type: "control",
		};
	}
	return null;
}
