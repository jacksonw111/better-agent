import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";

// R3-T3: folds opencode's `question.asked` — mirrors
// bridge-turns-retract.test.ts's approval-cancel coverage, split out purely
// to keep both files under the repo's 300-line file cap.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("folds a question event into its own turn", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "question",
			questions: [{ text: "Which env?", options: ["staging", "prod"] }],
			requestId: "q_1",
			title: "Need more info",
		}),
	]);
	expect(turns).toHaveLength(1);
	expect(turns[0].kind).toBe("question");
});

it("removes a still-open question card when a matching cancelled event arrives", () => {
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
	expect(turns).toHaveLength(0);
});

it("leaves other open question cards alone when a differently-id'd cancel arrives", () => {
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
	expect(turns[0].kind).toBe("question");
});

it("closes an in-flight assistant turn as a boundary, like approval does", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "partial" }),
		ev(2, {
			kind: "question",
			questions: [{ text: "Proceed?", options: ["yes", "no"] }],
			requestId: "q_3",
			title: "Confirm",
		}),
	]);
	expect(turns.map((turn) => turn.kind)).toEqual(["assistant", "question"]);
	const assistantTurn = turns[0];
	expect(assistantTurn.kind === "assistant" && assistantTurn.streaming).toBe(
		false
	);
});
