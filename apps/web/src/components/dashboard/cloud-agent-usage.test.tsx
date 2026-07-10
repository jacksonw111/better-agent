// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { CloudAgentUsageRow } from "@/utils/api-types";
import { CloudAgentUsageView } from "./cloud-agent-usage";

function row(
	agentId: string,
	name: string,
	costUsd: number,
	inputTokens: number,
	outputTokens: number,
	turns: number
): CloudAgentUsageRow {
	return { agentId, name, costUsd, inputTokens, outputTokens, turns };
}

const EMPTY_HINT = /No cloud agent usage yet/i;

const ROWS: CloudAgentUsageRow[] = [
	row("a1", "Research Bot", 1.25, 800, 400, 3),
	row("a2", "Support Bot", 0.5, 200, 100, 1),
];

it("renders one row per cloud agent with its cost and token total", () => {
	const { container } = render(
		<CloudAgentUsageView isEmpty={false} isPending={false} rows={ROWS} />
	);
	const view = within(container);
	expect(view.getByText("Cloud Agents")).toBeDefined();
	expect(view.getByText("Research Bot")).toBeDefined();
	expect(view.getByText("Support Bot")).toBeDefined();
	// Research's cost and compacted token total (800 + 400 = 1.2k).
	expect(view.getByText("$1.2500")).toBeDefined();
	expect(view.getByText("1.2k")).toBeDefined();
	// Support's cost, shown with the same 4-decimal formatter.
	expect(view.getByText("$0.5000")).toBeDefined();
});

it("shows a loading skeleton while pending", () => {
	const { container } = render(
		<CloudAgentUsageView isEmpty={false} isPending={true} rows={[]} />
	);
	expect(within(container).queryByText("Research Bot")).toBeNull();
});

it("shows a hint when the user has no cloud agent usage", () => {
	const { container } = render(
		<CloudAgentUsageView isEmpty={true} isPending={false} rows={[]} />
	);
	expect(within(container).getByText(EMPTY_HINT)).toBeDefined();
	expect(within(container).queryByText("Research Bot")).toBeNull();
});
