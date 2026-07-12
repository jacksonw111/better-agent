// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalChatPanel } from "./local-chat-panel";

vi.mock("@/components/bridge/local-agent-detail", () => ({
	LocalAgentDetail: ({ tokenId }: { tokenId: string }) => (
		<div data-testid="local-agent-detail">detail:{tokenId}</div>
	),
}));

const CLOSE_RE = /close/i;

afterEach(() => cleanup());

it("renders LocalAgentDetail for the given tokenId", () => {
	const { container } = render(
		<LocalChatPanel onClose={() => undefined} tokenId="token-42" />
	);
	const view = within(container);
	expect(view.getByTestId("local-agent-detail").textContent).toBe(
		"detail:token-42"
	);
});

it("fires onClose when the close button is clicked", () => {
	const onClose = vi.fn();
	const { container } = render(
		<LocalChatPanel onClose={onClose} tokenId="token-1" />
	);
	const view = within(container);
	fireEvent.click(view.getByRole("button", { name: CLOSE_RE }));
	expect(onClose).toHaveBeenCalledTimes(1);
});
