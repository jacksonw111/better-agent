// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const usageSummary = {
	windowDays: 7,
	daily: [],
	totals: { inputTokens: 0, outputTokens: 0, costCents: 0, turns: 0 },
};

const localAgentUsage = {
	windowDays: 7,
	byKind: [
		{
			agentKind: "claude-code",
			costUsd: 2.5,
			inputTokens: 900,
			outputTokens: 300,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
			turns: 5,
		},
	],
};

const cloudAgentUsage = {
	windowDays: 7,
	byAgent: [],
};

vi.mock("@/utils/orpc", () => ({
	orpc: {
		usage: {
			summary: {
				queryOptions: () => ({
					queryKey: ["usage", "summary"],
					queryFn: () => Promise.resolve(usageSummary),
				}),
			},
			dailyActivity: {
				queryOptions: () => ({
					queryKey: ["usage", "dailyActivity"],
					queryFn: () => Promise.resolve([]),
				}),
			},
			byAgent: {
				queryOptions: () => ({
					queryKey: ["usage", "byAgent"],
					queryFn: () => Promise.resolve(cloudAgentUsage),
				}),
			},
		},
		bridge: {
			usageByAgentKind: {
				queryOptions: () => ({
					queryKey: ["bridge", "usageByAgentKind"],
					queryFn: () => Promise.resolve(localAgentUsage),
				}),
			},
		},
	},
}));

async function renderDashboard() {
	const { DashboardPage } = await import("./dashboard");
	const queryClient = new QueryClient();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<DashboardPage />
		</QueryClientProvider>
	);
	return within(container);
}

it("renders the Local Agents breakdown and no Recent Activity timeline", async () => {
	const view = await renderDashboard();

	await waitFor(() => {
		expect(view.getByText("Agent Breakdown")).toBeDefined();
	});
	// A row for the populated claude-code kind.
	expect(view.getByText("Claude Code")).toBeDefined();
	expect(view.getByText("$2.5000")).toBeDefined();
	// The Recent Activity timeline is gone.
	expect(view.queryByText("Recent Activity")).toBeNull();
});
