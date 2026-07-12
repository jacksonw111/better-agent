// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { capabilities } from "./agent-capabilities";
import { TerminalHeaderOverflowMenu } from "./terminal-header-overflow-menu";

afterEach(cleanup);

// A live (non-ended) session with claude-code's real capability matrix, so
// the menu has something in every gated slot (Past conversations, Status,
// Restart, End) to assert on.
function renderMenu() {
	const { baseElement } = render(
		<TerminalHeaderOverflowMenu
			canSend
			caps={capabilities("claude-code")}
			ending={false}
			getStatus={() => Promise.resolve()}
			listSessions={() => undefined}
			onEnd={() => undefined}
			restart={() => Promise.resolve()}
			sessionList={null}
			status="live"
			statusSnapshot={null}
			usageUpdate={null}
		/>
	);
	return within(baseElement);
}

it("stays collapsed behind a single trigger until opened", () => {
	const view = renderMenu();

	expect(view.getByRole("button", { name: "More actions" })).toBeDefined();
	expect(view.queryByRole("button", { name: "Past conversations" })).toBeNull();
	expect(
		view.queryByRole("button", { name: "End local agent session" })
	).toBeNull();
});

it("reveals Past conversations, Status, Restart and End once opened", () => {
	const view = renderMenu();

	fireEvent.click(view.getByRole("button", { name: "More actions" }));

	expect(
		view.getByRole("button", { name: "Past conversations" })
	).toBeDefined();
	expect(view.getByRole("button", { name: "Status" })).toBeDefined();
	expect(
		view.getByRole("button", { name: "Restart local agent session" })
	).toBeDefined();
	expect(
		view.getByRole("button", { name: "End local agent session" })
	).toBeDefined();
});

it("hides Restart and End once the session has ended", () => {
	const { baseElement } = render(
		<TerminalHeaderOverflowMenu
			canSend={false}
			caps={capabilities("claude-code")}
			ending={false}
			getStatus={() => Promise.resolve()}
			listSessions={() => undefined}
			onEnd={() => undefined}
			restart={() => Promise.resolve()}
			sessionList={null}
			status="ended"
			statusSnapshot={null}
			usageUpdate={null}
		/>
	);
	const view = within(baseElement);
	fireEvent.click(view.getByRole("button", { name: "More actions" }));

	expect(
		view.queryByRole("button", { name: "Restart local agent session" })
	).toBeNull();
	expect(
		view.queryByRole("button", { name: "End local agent session" })
	).toBeNull();
});
