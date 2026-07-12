// @vitest-environment jsdom
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@better-agent/ui/components/reasoning";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";

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

/** The naturally-wrapping text inside the collapsed streaming window. */
function tickerText(container: HTMLElement): string | null {
	return (
		container.querySelector(".reasoning-ticker")?.textContent?.trim() ?? null
	);
}

it("stays collapsed by default, whether streaming or complete", () => {
	const streaming = renderReasoning(true, "thinking about the plan");
	expect(streaming.scope.queryByTestId("full-content")).toBeNull();

	const done = renderReasoning(false, "thinking about the plan");
	expect(done.scope.queryByTestId("full-content")).toBeNull();
});

it("streams the raw text into the bottom-anchored ticker window while collapsed", () => {
	const { container } = renderReasoning(
		true,
		"characters flow in and wrap by width, no sentence heuristics"
	);
	// The full (short) text participates in layout — wrapping is pure CSS.
	expect(tickerText(container)).toBe(
		"characters flow in and wrap by width, no sentence heuristics"
	);
});

it("updates the ticker text in place as more characters stream in", () => {
	const first = "step one in prog";
	const { container, rerender } = render(
		<Reasoning isStreaming text={first}>
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">{first}</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(tickerText(container)).toBe("step one in prog");

	const grown = "step one in progress, step two next";
	rerender(
		<Reasoning isStreaming text={grown}>
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">{grown}</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(tickerText(container)).toBe("step one in progress, step two next");
});

it("caps layout work on long reasoning: only the text TAIL is rendered", () => {
	const start = "START-OF-REASONING ";
	const filler = "x".repeat(1000);
	const end = " LATEST-TAIL";
	const { container } = renderReasoning(true, `${start}${filler}${end}`);
	const text = tickerText(container);
	// Only the visible tail participates in layout — the far-away start never
	// enters the DOM, keeping per-token reflow cost constant.
	expect(text?.endsWith("LATEST-TAIL")).toBe(true);
	expect(text?.includes("START-OF-REASONING")).toBe(false);
	expect(text?.length ?? 0).toBeLessThanOrEqual(400);
});

it("shows a stable first-line snippet once streaming is done", () => {
	const { container } = renderReasoning(
		false,
		"The first line of thought\nAnd a second line with more detail"
	);
	// Done state: no live ticker window, one stable snippet from the START.
	expect(container.querySelector(".reasoning-ticker")).toBeNull();
	expect(container.textContent).toContain("The first line of thought");
	expect(container.textContent).not.toContain("second line with more detail");
});

it("expands to the full text on click, and collapses again on a second click", () => {
	const { container, scope } = renderReasoning(
		false,
		"the full reasoning body"
	);
	expect(scope.queryByTestId("full-content")).toBeNull();

	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByTestId("full-content")).toBeDefined();
	// The collapsed preview disappears while expanded.
	expect(container.querySelector(".reasoning-ticker")).toBeNull();

	fireEvent.click(scope.getByRole("button"));
	expect(scope.queryByTestId("full-content")).toBeNull();
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
