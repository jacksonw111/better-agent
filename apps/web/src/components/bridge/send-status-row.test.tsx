// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BridgeChatRow } from "./bridge-chat-row";
import type { UserTurn } from "./bridge-turns";
import { registerSendOutboxActions } from "./send-outbox-store";

// fix-send-outbox: the user-facing contract — an undelivered message is NEVER
// rendered as a delivered one, and the user can act on it.

afterEach(cleanup);

function userTurn(overrides: Partial<UserTurn> = {}): UserTurn {
	return { id: -1, kind: "user", text: "hello", ...overrides };
}

function renderTurn(turn: UserTurn) {
	return render(
		<BridgeChatRow
			answered={{}}
			answeredQuestions={{}}
			ended={false}
			onAnswerApproval={() => undefined}
			onAnswerQuestion={() => undefined}
			turn={turn}
		/>
	);
}

it("renders an ordinary user message with no send-status affordances", () => {
	renderTurn(userTurn({ id: 7 }));

	expect(screen.getByText("hello")).toBeTruthy();
	expect(screen.queryByText("Sending…")).toBeNull();
	expect(screen.queryByTestId("send-failed")).toBeNull();
});

it("shows a quiet hint while the send is still queued", () => {
	renderTurn(userTurn({ sendKey: "key-1", sendStatus: "sending" }));

	expect(screen.getByText("Sending…")).toBeTruthy();
	expect(screen.queryByTestId("send-failed")).toBeNull();
});

it("drops the hint once the send lands", () => {
	renderTurn(userTurn({ sendKey: "key-1", sendStatus: "sent" }));

	expect(screen.queryByText("Sending…")).toBeNull();
	expect(screen.queryByTestId("send-failed")).toBeNull();
});

it("surfaces a failed send with retry and discard actions", () => {
	const retry = vi.fn();
	const discard = vi.fn();
	const unregister = registerSendOutboxActions({ discard, retry });
	renderTurn(userTurn({ sendKey: "key-1", sendStatus: "failed" }));

	expect(screen.getByText("Not sent")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(retry).toHaveBeenCalledWith("key-1");

	fireEvent.click(screen.getByRole("button", { name: "Discard" }));
	expect(discard).toHaveBeenCalledWith("key-1");
	unregister();
});

it("stays inert when no terminal has published its outbox actions", () => {
	renderTurn(userTurn({ sendKey: "key-1", sendStatus: "failed" }));

	// No throw — the buttons simply do nothing until a terminal is mounted.
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(screen.getByText("Not sent")).toBeTruthy();
});
