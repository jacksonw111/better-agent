// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { BridgeTurn } from "./bridge-turns";
import { TerminalFeed } from "./terminal-feed";
import { FEED_WINDOW_SIZE } from "./turn-window";

// Feed windowing: an agent can produce thousands of turns in one session, and
// mounting every one of them is what made the /tasks chat tab OOM the whole
// browser tab. Only the trailing FEED_WINDOW_SIZE turns mount; everything
// earlier hides behind a "Show earlier messages" control that reveals one
// more window per click.

const EXPAND_BUTTON_PATTERN = /Show earlier messages/;

function makeUserTurns(count: number): BridgeTurn[] {
	return Array.from({ length: count }, (_, index) => ({
		id: index + 1,
		kind: "user" as const,
		text: `msg-${index + 1}`,
	}));
}

function renderFeed(turns: BridgeTurn[]) {
	const answer = () => Promise.resolve();
	const { container } = render(
		<TerminalFeed
			answerApproval={answer}
			answered={{}}
			answeredQuestions={{}}
			answerQuestion={answer}
			avatars={{}}
			ended={false}
			turnInFlight={false}
			turns={turns}
		/>
	);
	return within(container);
}

it("mounts only the trailing FEED_WINDOW_SIZE turns, hiding earlier ones behind an expand control", () => {
	const total = FEED_WINDOW_SIZE * 2 + 30;
	const view = renderFeed(makeUserTurns(total));

	// The newest turn and the first turn inside the window are mounted…
	expect(view.getByText(`msg-${total}`)).toBeDefined();
	expect(view.getByText(`msg-${total - FEED_WINDOW_SIZE + 1}`)).toBeDefined();
	// …but nothing before the window is in the DOM at all.
	expect(view.queryByText(`msg-${total - FEED_WINDOW_SIZE}`)).toBeNull();
	expect(view.queryByText("msg-1")).toBeNull();

	const button = view.getByRole("button", { name: EXPAND_BUTTON_PATTERN });
	expect(button.textContent).toContain(`还有 ${total - FEED_WINDOW_SIZE} 条`);
});

it("each expand click reveals one more window of earlier turns, until all are shown", () => {
	const total = FEED_WINDOW_SIZE * 2 + 30;
	const view = renderFeed(makeUserTurns(total));

	fireEvent.click(view.getByRole("button", { name: EXPAND_BUTTON_PATTERN }));
	const shownAfterOneClick = FEED_WINDOW_SIZE * 2;
	expect(view.getByText(`msg-${total - shownAfterOneClick + 1}`)).toBeDefined();
	expect(view.queryByText(`msg-${total - shownAfterOneClick}`)).toBeNull();
	expect(
		view.getByRole("button", { name: EXPAND_BUTTON_PATTERN }).textContent
	).toContain(`还有 ${total - shownAfterOneClick} 条`);

	fireEvent.click(view.getByRole("button", { name: EXPAND_BUTTON_PATTERN }));
	expect(view.getByText("msg-1")).toBeDefined();
	expect(
		view.queryByRole("button", { name: EXPAND_BUTTON_PATTERN })
	).toBeNull();
});

it("shows no expand control when the whole feed fits inside the window", () => {
	const view = renderFeed(makeUserTurns(FEED_WINDOW_SIZE));
	expect(view.getByText("msg-1")).toBeDefined();
	expect(view.getByText(`msg-${FEED_WINDOW_SIZE}`)).toBeDefined();
	expect(
		view.queryByRole("button", { name: EXPAND_BUTTON_PATTERN })
	).toBeNull();
});
