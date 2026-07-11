// R3-T3: questions.ts's registry + presentQuestion — mirrors
// approvals.test.ts/present-approval.test.ts's coverage for the parallel
// question machinery.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionEvent } from "../normalize/types";
import { APPROVAL_TIMEOUT_MS } from "./approvals";
import { createFakeEvents } from "./approvals-test-helpers";
import {
	createQuestionRegistry,
	presentQuestion,
	retractPendingQuestions,
} from "./questions";

const QUESTION_EVENT: QuestionEvent = {
	kind: "question",
	requestId: "q_1",
	title: "Need more info",
	questions: [{ text: "Which env?", options: ["staging", "prod"] }],
};

describe("createQuestionRegistry - double answer", () => {
	it("invokes the reply exactly once; a second answer for the same id is a no-op status warning", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createQuestionRegistry(events);
		const reply = vi.fn();
		registry.register("q_1", reply);

		registry.answer("q_1", [["staging"]]);
		registry.answer("q_1", [["staging"]]);

		expect(reply).toHaveBeenCalledExactlyOnceWith([["staging"]]);
		expect(pushed).toEqual([
			{
				kind: "status",
				status: "question_unknown",
				detail: { requestId: "q_1" },
			},
		]);
	});
});

describe("createQuestionRegistry - exit then answer", () => {
	it("does not throw and does not reply once cleared before an answer arrives", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createQuestionRegistry(events);
		const reply = vi.fn();
		registry.register("q_1", reply);

		registry.clear();

		expect(() => registry.answer("q_1", [["staging"]])).not.toThrow();
		expect(reply).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				kind: "status",
				status: "question_unknown",
				detail: { requestId: "q_1" },
			},
		]);
	});
});

describe("createQuestionRegistry - retractAll", () => {
	it("drops every pending reply without invoking it, and returns their requestIds", () => {
		const { events } = createFakeEvents();
		const registry = createQuestionRegistry(events);
		const replyA = vi.fn();
		const replyB = vi.fn();
		registry.register("q_1", replyA);
		registry.register("q_2", replyB);

		const retracted = registry.retractAll();

		expect(retracted.sort()).toEqual(["q_1", "q_2"]);
		expect(replyA).not.toHaveBeenCalled();
		expect(replyB).not.toHaveBeenCalled();
	});

	it("returns an empty list and is a no-op when nothing is pending", () => {
		const { events } = createFakeEvents();
		const registry = createQuestionRegistry(events);
		expect(registry.retractAll()).toEqual([]);
	});
});

describe("retractPendingQuestions", () => {
	it("pushes a cancelled QuestionEvent for every pending request, then leaves them un-repliable", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createQuestionRegistry(events);
		const reply = vi.fn();
		registry.register("q_1", reply);

		retractPendingQuestions(registry, events);

		expect(pushed).toEqual([
			{
				cancelled: true,
				kind: "question",
				questions: [],
				requestId: "q_1",
				title: "Cancelled",
			},
		]);
		registry.answer("q_1", [["staging"]]);
		expect(reply).not.toHaveBeenCalled();
	});
});

describe("presentQuestion - answered on time (fail-closed + timeout contract)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("pushes the card and, on an on-time answer, calls onAnswer and never times out", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createQuestionRegistry(events);
		const onAnswer = vi.fn();
		const onTimeout = vi.fn();

		presentQuestion({
			event: QUESTION_EVENT,
			events,
			onAnswer,
			onTimeout,
			questions: registry,
		});
		expect(pushed).toEqual([
			{
				...QUESTION_EVENT,
				timeoutAt: APPROVAL_TIMEOUT_MS,
				timeoutMs: APPROVAL_TIMEOUT_MS,
			},
		]);

		registry.answer("q_1", [["staging"]]);
		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);

		expect(onAnswer).toHaveBeenCalledExactlyOnceWith([["staging"]]);
		expect(onTimeout).not.toHaveBeenCalled();
	});
});

// Split into its own `describe` purely to keep each callback under the
// repo's max-lines-per-function gate.
describe("presentQuestion - unanswered times out (fail-closed + timeout contract)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves declined with a visible event once the timeout elapses unanswered", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createQuestionRegistry(events);
		const onAnswer = vi.fn();
		const onTimeout = vi.fn();

		presentQuestion({
			event: QUESTION_EVENT,
			events,
			onAnswer,
			onTimeout,
			questions: registry,
		});
		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);

		expect(onTimeout).toHaveBeenCalledOnce();
		expect(onAnswer).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				...QUESTION_EVENT,
				timeoutAt: APPROVAL_TIMEOUT_MS,
				timeoutMs: APPROVAL_TIMEOUT_MS,
			},
			{
				cancelled: true,
				kind: "question",
				questions: [],
				requestId: "q_1",
				title: "Timed out — declined",
			},
		]);

		// A late answer after the timeout already resolved this id is a no-op.
		registry.answer("q_1", [["staging"]]);
		expect(onAnswer).not.toHaveBeenCalled();
	});
});
