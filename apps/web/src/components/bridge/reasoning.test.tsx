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

/** The visible sentence lines of the collapsed streaming ticker, in order. */
function tickerLines(container: HTMLElement): string[] {
	return Array.from(
		container.querySelectorAll(".reasoning-ticker-line"),
		(line) => line.textContent ?? ""
	);
}

it("stays collapsed by default, whether streaming or complete", () => {
	const streaming = renderReasoning(true, "thinking about the plan");
	expect(streaming.scope.queryByTestId("full-content")).toBeNull();

	const done = renderReasoning(false, "thinking about the plan");
	expect(done.scope.queryByTestId("full-content")).toBeNull();
});

it("shows the newest sentences as vertical ticker lines while streaming", () => {
	const { container } = renderReasoning(
		true,
		"First I look at the tests. Then I read the reducer. Now checking the fold state."
	);
	// A two-line window over the NEWEST sentences — the oldest one scrolled out.
	expect(tickerLines(container)).toEqual([
		"Then I read the reducer.",
		"Now checking the fold state.",
	]);
});

it("scrolls sentence-by-sentence: a new sentence pushes the window down by one", () => {
	const first = "Step one done. Step two in progress";
	const { container, rerender } = render(
		<Reasoning isStreaming text={first}>
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">{first}</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(tickerLines(container)).toEqual([
		"Step one done.",
		"Step two in progress",
	]);

	// The forming tail sentence grows in place (same window, updated text)…
	const grown = "Step one done. Step two in progress, almost there.";
	rerender(
		<Reasoning isStreaming text={grown}>
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">{grown}</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(tickerLines(container)).toEqual([
		"Step one done.",
		"Step two in progress, almost there.",
	]);

	// …and a NEW sentence shifts the window: the oldest line scrolls out the top.
	const next = `${grown} Step three begins`;
	rerender(
		<Reasoning isStreaming text={next}>
			<ReasoningTrigger label="Reasoning" />
			<ReasoningContent>
				<p data-testid="full-content">{next}</p>
			</ReasoningContent>
		</Reasoning>
	);
	expect(tickerLines(container)).toEqual([
		"Step two in progress, almost there.",
		"Step three begins",
	]);
});

it("splits CJK sentences on 。！？ boundaries too", () => {
	const { container } = renderReasoning(
		true,
		"先看测试。再读折叠器！现在检查状态"
	);
	expect(tickerLines(container)).toEqual(["再读折叠器！", "现在检查状态"]);
});

it("shows a stable first-sentence snippet once streaming is done", () => {
	const { container } = renderReasoning(
		false,
		"The conclusion sentence. More detail follows here."
	);
	// Done state: no ticker, one stable snippet line from the START.
	expect(tickerLines(container)).toEqual([]);
	expect(container.textContent).toContain("The conclusion sentence.");
	expect(container.textContent).not.toContain("More detail follows");
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
