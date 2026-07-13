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

const SINGLE_EVENT: QuestionEvent = {
	kind: "question",
	questions: [{ text: "Which env?", options: ["staging", "prod"] }],
	requestId: "q_single",
	title: "Need more info",
};

it("renders a pending multi-question card as a wizard: first question only, with progress", () => {
	const { container } = render(<QuestionCard event={EVENT} />);
	const view = within(container);
	expect(view.getByText("Need more info")).toBeDefined();
	expect(view.getByText("Which env?")).toBeDefined();
	expect(view.queryByText("Proceed?")).toBeNull();
	expect(view.getByText("1/2")).toBeDefined();
	expect(view.getByRole("button", { name: "staging" })).toBeDefined();
	expect(view.queryByRole("button", { name: "yes" })).toBeNull();
});

it("steps through the wizard (Next disabled until a pick, Back revisits) and submits all answers in order", () => {
	const onAnswer = vi.fn();
	const { container } = render(
		<QuestionCard event={EVENT} onAnswer={onAnswer} />
	);
	const view = within(container);
	const next = view.getByRole("button", { name: "Next" }) as HTMLButtonElement;
	expect(next.disabled).toBe(true);

	fireEvent.click(view.getByRole("button", { name: "staging" }));
	expect(next.disabled).toBe(false);
	fireEvent.click(next);
	expect(view.getByText("Proceed?")).toBeDefined();
	expect(view.getByText("2/2")).toBeDefined();

	fireEvent.click(view.getByRole("button", { name: "Back" }));
	expect(view.getByText("Which env?")).toBeDefined();
	fireEvent.click(view.getByRole("button", { name: "Next" }));

	fireEvent.click(view.getByRole("button", { name: "yes" }));
	fireEvent.click(view.getByRole("button", { name: "Submit" }));
	expect(onAnswer).toHaveBeenCalledExactlyOnceWith("q_1", [
		["staging"],
		["yes"],
	]);
});

it("keeps a single-question card stacked and submits its one answer", () => {
	const onAnswer = vi.fn();
	const { container } = render(
		<QuestionCard event={SINGLE_EVENT} onAnswer={onAnswer} />
	);
	const view = within(container);
	expect(view.queryByRole("button", { name: "Next" })).toBeNull();
	const submit = view.getByRole("button", {
		name: "Submit",
	}) as HTMLButtonElement;
	expect(submit.disabled).toBe(true);
	fireEvent.click(view.getByRole("button", { name: "prod" }));
	expect(submit.disabled).toBe(false);
	fireEvent.click(submit);
	expect(onAnswer).toHaveBeenCalledExactlyOnceWith("q_single", [["prod"]]);
});

it("picks with digit keys and advances/submits with Enter", () => {
	const onAnswer = vi.fn();
	render(<QuestionCard event={EVENT} onAnswer={onAnswer} />);

	fireEvent.keyDown(document, { key: "1" });
	fireEvent.keyDown(document, { key: "Enter" });
	fireEvent.keyDown(document, { key: "2" });
	fireEvent.keyDown(document, { key: "Enter" });
	expect(onAnswer).toHaveBeenCalledExactlyOnceWith("q_1", [
		["staging"],
		["no"],
	]);
});

it("ignores Enter without a pick, out-of-range digits, and modified keys", () => {
	const onAnswer = vi.fn();
	const { container } = render(
		<QuestionCard event={SINGLE_EVENT} onAnswer={onAnswer} />
	);
	fireEvent.keyDown(document, { key: "Enter" });
	fireEvent.keyDown(document, { key: "9" });
	fireEvent.keyDown(document, { key: "1", metaKey: true });
	fireEvent.keyDown(document, { key: "Enter" });
	expect(onAnswer).not.toHaveBeenCalled();
	const staging = within(container).getByRole("button", { name: "staging" });
	expect(staging.getAttribute("aria-pressed")).toBe("false");
});

it("does not hijack digits typed into a text input", () => {
	const { container } = render(
		<div>
			<input aria-label="composer" type="text" />
			<QuestionCard event={SINGLE_EVENT} />
		</div>
	);
	const view = within(container);
	fireEvent.keyDown(view.getByLabelText("composer"), { key: "1" });
	expect(
		view.getByRole("button", { name: "staging" }).getAttribute("aria-pressed")
	).toBe("false");
});

// R3-4 review finding 5: `key={option}`/`key={question.text}` collide when
// two options (within one question) or two questions share a label/text —
// React warns "Encountered two children with the same key" and reconciliation
// can mix up which row's state belongs to which DOM node.
it("keys duplicate-labeled options uniquely (no React duplicate-key warning)", () => {
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

	render(<QuestionCard answered={[["Yes"], ["No"]]} event={duplicateEvent} />);

	const duplicateKeyWarning = consoleError.mock.calls.some(([message]) =>
		typeof message === "string" ? message.includes("same key") : false
	);
	expect(duplicateKeyWarning).toBe(false);
	consoleError.mockRestore();
});

it("shows every question read-only (stacked) once `answered` is set, keyboard inert", () => {
	const onAnswer = vi.fn();
	const { container } = render(
		<QuestionCard
			answered={[["staging"], ["no"]]}
			event={EVENT}
			onAnswer={onAnswer}
		/>
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
	fireEvent.keyDown(document, { key: "1" });
	fireEvent.keyDown(document, { key: "Enter" });
	expect(onAnswer).not.toHaveBeenCalled();
});
