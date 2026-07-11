// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import { LocalAgentConnectionPanel } from "./local-agent-connection-panel";

const CLI_COMMAND_RE = /agent-cli/;
const RECREATE_HINT_RE = /recreate it/i;

function makeToken(overrides: Partial<BridgeTokenRow> = {}): BridgeTokenRow {
	return {
		id: "token-1",
		userId: "user-1",
		name: "My laptop",
		agentKind: "codex",
		token: "bt_secret",
		last4: "cret",
		config: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		revokedAt: null,
		...overrides,
	};
}

function renderPanel(token: BridgeTokenRow) {
	const { container } = render(<LocalAgentConnectionPanel token={token} />);
	return within(container);
}

it("shows the raw token and a CLI command bound to its agent kind", () => {
	const view = renderPanel(makeToken());

	expect(view.getByText("bt_secret")).toBeDefined();
	const command = view.getByText(CLI_COMMAND_RE);
	expect(command.textContent).toContain("--agent codex");
	expect(command.textContent).toContain("--token bt_secret");
	expect(view.getByRole("button", { name: "Copy token" })).toBeDefined();
	expect(view.getByRole("button", { name: "Copy command" })).toBeDefined();
	// Deleting a local agent moved to the list page's Actions column.
	expect(view.queryByRole("button", { name: "Delete" })).toBeNull();
});

it("shows a recreate hint for a legacy hash-only token", () => {
	const view = renderPanel(makeToken({ token: null }));

	expect(view.queryByText(CLI_COMMAND_RE)).toBeNull();
	expect(view.getByText(RECREATE_HINT_RE)).toBeDefined();
});
