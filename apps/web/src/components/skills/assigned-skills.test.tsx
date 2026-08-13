// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssignedSkills } from "./assigned-skills";

// Mocked-orpc pattern: no RouterProvider/backend needed, just a fake orpc
// client whose mutation functions record their args so the test can assert
// the right procedure (assignAgent/unassignAgent) was called with the right
// ids.

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

const AGENT_ID = "agent-1";

const store = vi.hoisted(() => ({
	assignArgs: [] as Record<string, unknown>[],
	unassignArgs: [] as Record<string, unknown>[],
	assigned: [{ id: "skill-1", name: "Deploy" }] as {
		id: string;
		name: string;
	}[],
	all: [
		{ id: "skill-1", name: "Deploy" },
		{ id: "skill-2", name: "Triage" },
	] as { id: string; name: string }[],
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		skills: {
			list: {
				queryOptions: () => ({
					queryKey: ["skills", "list"],
					queryFn: () => Promise.resolve(store.all),
				}),
			},
			listAssigned: {
				key: () => ["skills", "listAssigned"],
				queryOptions: () => ({
					queryKey: ["skills", "listAssigned", AGENT_ID],
					queryFn: () => Promise.resolve(store.assigned),
				}),
			},
			assignAgent: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.assignArgs.push(args);
						return Promise.resolve({ ok: true });
					},
					...opts,
				}),
			},
			unassignAgent: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.unassignArgs.push(args);
						return Promise.resolve({ ok: true });
					},
					...opts,
				}),
			},
		},
	},
}));

afterEach(cleanup);
beforeEach(() => {
	store.assignArgs.length = 0;
	store.unassignArgs.length = 0;
});

function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<AssignedSkills agentId={AGENT_ID} />
		</QueryClientProvider>
	);
}

it("shows the agent's already-assigned skills and the remaining ones to assign", async () => {
	const view = renderPanel();
	await waitFor(() => {
		expect(view.getByText("Deploy")).toBeDefined();
	});
	expect(view.getByRole("button", { name: "Triage" })).toBeDefined();
});

it("calls assignAgent with the agent and skill ids when an unassigned skill is picked", async () => {
	const view = renderPanel();
	const triageButton = await waitFor(() =>
		view.getByRole("button", { name: "Triage" })
	);
	fireEvent.click(triageButton);

	await waitFor(() => {
		expect(store.assignArgs).toHaveLength(1);
	});
	expect(store.assignArgs[0]).toEqual({
		agentId: AGENT_ID,
		skillId: "skill-2",
	});
});

it("calls unassignAgent with the agent and skill ids when an assigned skill's remove button is clicked", async () => {
	const view = renderPanel();
	const unassignButton = await waitFor(() =>
		view.getByRole("button", { name: "Unassign Deploy" })
	);
	fireEvent.click(unassignButton);

	await waitFor(() => {
		expect(store.unassignArgs).toHaveLength(1);
	});
	expect(store.unassignArgs[0]).toEqual({
		agentId: AGENT_ID,
		skillId: "skill-1",
	});
});
