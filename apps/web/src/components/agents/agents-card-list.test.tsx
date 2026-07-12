// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentRow } from "@/utils/api-types";
import { AgentsCardList } from "./agents-card-list";

const TOKEN_PREVIEW_PATTERN = /bt_agent1token/;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		...rest
	}: { children: ReactNode } & Record<string, unknown>) => (
		<a {...rest}>{children}</a>
	),
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		agents: {
			getToken: {
				queryOptions: () => ({
					queryKey: ["agents", "getToken", "agent-1"],
					queryFn: () => Promise.resolve("bt_agent1token"),
				}),
			},
			rotateToken: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: () => Promise.resolve({ token: "bt_rotated" }),
					...opts,
				}),
			},
		},
	},
}));

function makeRow(overrides: Partial<AgentRow> = {}): AgentRow {
	return {
		id: "agent-1",
		userId: "user-1",
		name: "alpha agent",
		description: "",
		providerId: "anthropic",
		modelId: "claude-sonnet",
		systemPrompt: "",
		params: null,
		builtinTools: [],
		composioAccountIds: [],
		mcpServerIds: [],
		toolAllowlist: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		updatedAt: new Date("2026-07-04T12:00:00Z"),
		...overrides,
	} as AgentRow;
}

function renderList(
	onEdit: (row: AgentRow) => void,
	onDelete: (id: string) => void,
	rows = [makeRow()]
) {
	const queryClient = new QueryClient();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<AgentsCardList
				onDelete={onDelete}
				onEdit={onEdit}
				onTokenRotated={() => {
					// no-op
				}}
				rows={rows}
			/>
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		list: within(container),
	};
}

afterEach(() => {
	cleanup();
});

it("renders a card per row with its name and provider/model", async () => {
	const { list } = renderList(
		() => {
			// no-op
		},
		() => {
			// no-op
		}
	);

	expect(list.getByText("alpha agent")).toBeDefined();
	expect(list.getByText("anthropic/claude-sonnet")).toBeDefined();
	await waitFor(() => {
		expect(list.getByText(TOKEN_PREVIEW_PATTERN)).toBeDefined();
	});
});

it("fires onEdit when the edit action is clicked", () => {
	const onEdit = vi.fn();
	const { list } = renderList(onEdit, () => {
		// no-op
	});

	fireEvent.click(list.getByRole("button", { name: "Edit agent" }));
	expect(onEdit).toHaveBeenCalledWith(
		expect.objectContaining({ id: "agent-1" })
	);
});

it("deletes from the card footer after confirming", () => {
	const onDelete = vi.fn();
	const { body, list } = renderList(() => {
		// no-op
	}, onDelete);

	fireEvent.click(list.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	expect(onDelete).toHaveBeenCalledWith("agent-1");
});

it("shows an empty state when there are no rows", () => {
	const { list } = renderList(() => {
		// no-op
	}, () => {
		// no-op
	}, []);

	expect(list.getByText("No agents yet")).toBeDefined();
});
