// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { QuestionEvent } from "./bridge-events";
import { QuestionCard } from "./question-card";

const EVENT: QuestionEvent = {
	kind: "question",
	questions: [
		{ text: "Which env?", options: ["staging", "prod"] },
		{ text: "Proceed?", options: ["yes", "no"] },
	],
	requestId: "q_1",
	title: "Need more info",
};

it("renders the title and every question's option buttons", () => {
	const { container } = render(<QuestionCard event={EVENT} />);
	const view = within(container);
	expect(view.getByText("Need more info")).toBeDefined();
	expect(view.getByText("Which env?")).toBeDefined();
	expect(view.getByText("Proceed?")).toBeDefined();
	for (const label of ["staging", "prod", "yes", "no"]) {
		expect(view.getByRole("button", { name: label })).toBeDefined();
	}
});

it("keeps Submit disabled until every question has a pick, then submits all answers in order", () => {
	const onAnswer = vi.fn();
	const { container } = render(
		<QuestionCard event={EVENT} onAnswer={onAnswer} />
	);
	const view = within(container);
	const submit = view.getByRole("button", {
		name: "Submit",
	}) as HTMLButtonElement;
	expect(submit.disabled).toBe(true);

	fireEvent.click(view.getByRole("button", { name: "staging" }));
	expect(submit.disabled).toBe(true);

	fireEvent.click(view.getByRole("button", { name: "yes" }));
	expect(submit.disabled).toBe(false);

	fireEvent.click(submit);
	expect(onAnswer).toHaveBeenCalledExactlyOnceWith("q_1", [
		["staging"],
		["yes"],
	]);
});

// R3-4 review finding 5: `key={option}`/`key={question.text}` collide when
// two options (within one question) or two questions share a label/text —
// React warns "Encountered two children with the same key" and reconciliation
// can mix up which row's state belongs to which DOM node.
it("keys duplicate-labeled options and duplicate-text questions uniquely (no React duplicate-key warning)", () => {
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);
	const duplicateEvent: QuestionEvent = {
		kind: "question",
		questions: [
			{ text: "Confirm?", options: ["Yes", "Yes", "No"] },
			{ text: "Confirm?", options: ["Yes", "No"] },
		],
		requestId: "q_dup",
		title: "Duplicate labels",
	};

	render(<QuestionCard event={duplicateEvent} />);

	const duplicateKeyWarning = consoleError.mock.calls.some(([message]) =>
		typeof message === "string" ? message.includes("same key") : false
	);
	expect(duplicateKeyWarning).toBe(false);
	consoleError.mockRestore();
});

it("disables every option and shows the chosen one once `answered` is set", () => {
	const { container } = render(
		<QuestionCard answered={[["staging"], ["no"]]} event={EVENT} />
	);
	const view = within(container);
	for (const label of ["staging", "prod", "yes", "no", "Submit"]) {
		expect(
			(view.getByRole("button", { name: label }) as HTMLButtonElement).disabled
		).toBe(true);
	}
	expect(
		view.getByRole("button", { name: "staging" }).getAttribute("aria-pressed")
	).toBe("true");
	expect(
		view.getByRole("button", { name: "no" }).getAttribute("aria-pressed")
	).toBe("true");
	expect(
		view.getByRole("button", { name: "prod" }).getAttribute("aria-pressed")
	).toBe("false");
});
