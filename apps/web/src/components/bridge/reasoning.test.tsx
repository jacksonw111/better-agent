// @vitest-environment jsdom
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@better-agent/ui/components/reasoning";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";

const FILLER_REPEAT_COUNT = 20;

function renderReasoning(isStreaming: boolean, text: string) {
	const { container } = render(
		<Reasoning isStreaming={isStreaming} text={text}>
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">{text}</p>
			</ReasoningContent>
		</Reasoning>
	);
	return { container, scope: within(container) };
}

function previewText(container: HTMLElement): string | null {
	return container.querySelector(".reasoning-tail")?.textContent ?? null;
}

it("stays collapsed by default, whether streaming or complete", () => {
	const streaming = renderReasoning(true, "thinking about the plan");
	expect(streaming.scope.queryByTestId("full-content")).toBeNull();

	const done = renderReasoning(false, "thinking about the plan");
	expect(done.scope.queryByTestId("full-content")).toBeNull();
});

it("shows a single-line tail preview of the latest streamed text while collapsed", () => {
	const longText = `START of the reasoning that scrolled by ${"filler ".repeat(FILLER_REPEAT_COUNT)}latest tail content`;
	const { container } = renderReasoning(true, longText);
	const preview = previewText(container);
	// The preview shows the END of the string (the newest text), not the start.
	expect(preview).not.toBeNull();
	expect(preview?.endsWith("latest tail content")).toBe(true);
	expect(preview?.includes("START")).toBe(false);
});

it("updates the tail preview as more text streams in", () => {
	const { container, rerender } = render(
		<Reasoning isStreaming text="START step one">
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">START step one</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(previewText(container)).toBe("START step one");
	rerender(
		<Reasoning isStreaming text="START step one, then step two">
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">START step one, then step two</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(previewText(container)).toBe("START step one, then step two");
});

it("expands to the full text on click, and collapses again on a second click", () => {
	const { container, scope } = renderReasoning(
		false,
		"the full reasoning body"
	);
	expect(scope.queryByTestId("full-content")).toBeNull();
	expect(previewText(container)).not.toBeNull();

	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByTestId("full-content")).toBeDefined();
	expect(previewText(container)).toBeNull();

	fireEvent.click(scope.getByRole("button"));
	expect(scope.queryByTestId("full-content")).toBeNull();
	expect(previewText(container)).not.toBeNull();
});

it("stays expanded across re-renders once the user has manually expanded it", () => {
	const { container, rerender } = render(
		<Reasoning isStreaming text="working on it">
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">working on it</p>
			</ReasoningContent>
		</Reasoning>
	);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByTestId("full-content")).toBeDefined();

	// A re-render mid-stream (new text arriving) must not auto-collapse the
	// panel the user chose to open.
	rerender(
		<Reasoning isStreaming text="working on it, still going">
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">working on it, still going</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(scope.getByTestId("full-content")).toBeDefined();

	// And finishing the stream (isStreaming flips to false) must not
	// auto-collapse it either.
	rerender(
		<Reasoning isStreaming={false} text="working on it, still going">
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">working on it, still going</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(scope.getByTestId("full-content")).toBeDefined();
});
