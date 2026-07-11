// R3-T3: `question.asked` handling — split out of opencode-serve.test.ts
// purely to keep both files under the repo's 300-line file cap.

import { describe, expect, it } from "vitest";
import { createOpencodeServeNormalizer } from "./opencode-serve";

const SESSION_ID = "ses_1";

function questionAskedEvent(
	properties: Record<string, unknown>
): Record<string, unknown> {
	return {
		type: "question.asked",
		properties: { sessionID: SESSION_ID, ...properties },
	};
}

describe("createOpencodeServeNormalizer - question.asked", () => {
	it("normalizes a well-formed multi-question request with option labels", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);

		const events = normalize(
			questionAskedEvent({
				id: "q_1",
				title: "Need more info",
				questions: [
					{ question: "Which env?", options: ["staging", "prod"] },
					{ question: "Proceed?", options: ["yes", "no"] },
				],
			})
		);

		expect(events).toEqual([
			{
				kind: "question",
				requestId: "q_1",
				title: "Need more info",
				questions: [
					{ text: "Which env?", options: ["staging", "prod"] },
					{ text: "Proceed?", options: ["yes", "no"] },
				],
			},
		]);
	});

	it("accepts requestID in place of id, and text in place of question", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);

		const events = normalize(
			questionAskedEvent({
				requestID: "q_2",
				questions: [{ text: "Which one?", options: ["a", "b"] }],
			})
		);

		expect(events).toMatchObject({
			0: { kind: "question", requestId: "q_2" },
		});
	});
});

// Split into its own `describe` purely to keep each callback under the
// repo's max-lines-per-function gate.
describe("createOpencodeServeNormalizer - question.asked label records", () => {
	it("extracts option labels from an array of {label} records, not just strings", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);

		const events = normalize(
			questionAskedEvent({
				id: "q_3",
				questions: [
					{
						question: "Pick",
						labels: [{ label: "One" }, { label: "Two" }],
					},
				],
			})
		);

		expect(events).toEqual([
			{
				kind: "question",
				requestId: "q_3",
				title: "Question",
				questions: [{ text: "Pick", options: ["One", "Two"] }],
			},
		]);
	});
});

// Split into its own `describe` purely to keep each callback under the
// repo's max-lines-per-function gate.
describe("createOpencodeServeNormalizer - question.asked degradation", () => {
	it("degrades to a single reject-able yes/no question when the shape is unrecognized", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);

		const events = normalize(
			questionAskedEvent({
				id: "q_4",
				title: "Odd payload",
				questions: "nonsense",
			})
		);

		expect(events).toEqual([
			{
				kind: "question",
				requestId: "q_4",
				title: "Odd payload",
				questions: [{ text: "Odd payload", options: ["Yes", "No"] }],
			},
		]);
	});

	it("drops the event entirely when no id/requestID is present", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);

		expect(normalize(questionAskedEvent({ questions: [] }))).toEqual([]);
	});

	it("drops question.asked events for a different session", () => {
		const normalize = createOpencodeServeNormalizer(SESSION_ID);

		expect(
			normalize({
				type: "question.asked",
				properties: { id: "q_5", sessionID: "ses_other", questions: [] },
			})
		).toEqual([]);
	});
});
