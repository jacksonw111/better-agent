// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import { LocalAgentConnectionPanel } from "./local-agent-connection-panel";

const CLI_COMMAND_RE = /agent-cli/;

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

it("shows the agent's identity and settings entry point", () => {
	const view = renderPanel(makeToken());

	expect(view.getByText("My laptop")).toBeDefined();
	expect(view.getByText("Codex")).toBeDefined();
	expect(view.getByRole("button", { name: "Settings" })).toBeDefined();
});

it("no longer surfaces the raw token or a copyable CLI command (S3-T3)", () => {
	const view = renderPanel(makeToken());

	expect(view.queryByText("bt_secret")).toBeNull();
	expect(view.queryByText(CLI_COMMAND_RE)).toBeNull();
	expect(view.queryByRole("button", { name: "Copy token" })).toBeNull();
	expect(view.queryByRole("button", { name: "Copy command" })).toBeNull();
});
