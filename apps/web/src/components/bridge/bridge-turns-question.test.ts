import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";

// R3-T3: folds opencode's `question.asked`. A question now folds INTO the
// in-flight assistant turn as a block (sharing its avatar/spine, and letting
// the post-answer continuation merge into the same turn) instead of becoming
// its own turn — see bridge-turns-approval.ts.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("folds a question event into the assistant turn as a block", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "question",
			questions: [{ text: "Which env?", options: ["staging", "prod"] }],
			requestId: "q_1",
			title: "Need more info",
		}),
	]);
	expect(turns).toHaveLength(1);
	expect(turns[0].kind).toBe("assistant");
	const turn = turns[0];
	expect(
		turn.kind === "assistant" &&
			turn.blocks.some((block) => block.kind === "question")
	).toBe(true);
});

it("removes a still-open question block when a matching cancelled event arrives", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "question",
			questions: [{ text: "Which env?", options: ["staging", "prod"] }],
			requestId: "q_1",
			title: "Need more info",
		}),
		ev(2, {
			kind: "question",
			cancelled: true,
			questions: [],
			requestId: "q_1",
			title: "Cancelled",
		}),
	]);
	// The block was the turn's only content, so retracting it drops the turn.
	expect(turns).toHaveLength(0);
});

it("leaves other open question blocks alone when a differently-id'd cancel arrives", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "question",
			questions: [{ text: "Which env?", options: ["staging", "prod"] }],
			requestId: "q_1",
			title: "Need more info",
		}),
		ev(2, {
			kind: "question",
			cancelled: true,
			questions: [],
			requestId: "q_2",
			title: "Cancelled",
		}),
	]);
	expect(turns).toHaveLength(1);
	expect(turns[0].kind).toBe("assistant");
	const turn = turns[0];
	expect(
		turn.kind === "assistant" &&
			turn.blocks.some(
				(block) =>
					block.kind === "question" && block.question.requestId === "q_1"
			)
	).toBe(true);
});

// fix-question-replay: a resolution event (answeredAnswers set) is a
// persistence marker for the answeredQuestions map (use-bridge-feed.ts), not a
// fresh request — folding it must neither append a second card nor remove the
// original one.
it("a resolution event neither appends a new card nor removes the original", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "question",
			questions: [{ text: "Which env?", options: ["staging", "prod"] }],
			requestId: "q_1",
			title: "Need more info",
		}),
		ev(2, {
			kind: "question",
			answeredAnswers: [["staging"]],
			questions: [],
			requestId: "q_1",
			title: "Answered",
		}),
	]);
	expect(turns).toHaveLength(1);
	const turn = turns[0];
	expect(turn.kind).toBe("assistant");
	expect(
		turn.kind === "assistant"
			? turn.blocks.filter((block) => block.kind === "question").length
			: 0
	).toBe(1);
});

it("folds a question into the SAME assistant turn, not as a boundary", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "partial" }),
		ev(2, {
			kind: "question",
			questions: [{ text: "Proceed?", options: ["yes", "no"] }],
			requestId: "q_3",
			title: "Confirm",
		}),
	]);
	// The question merges into the assistant turn started by the output, so the
	// post-answer continuation will too — no fresh avatar, no broken spine.
	expect(turns.map((turn) => turn.kind)).toEqual(["assistant"]);
	const turn = turns[0];
	expect(
		turn.kind === "assistant" &&
			turn.blocks.some((block) => block.kind === "text") &&
			turn.blocks.some((block) => block.kind === "question")
	).toBe(true);
});
