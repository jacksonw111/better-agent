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
