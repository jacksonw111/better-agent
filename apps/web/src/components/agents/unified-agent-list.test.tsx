// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentRow } from "@/utils/api-types";
import { CloudAgentList } from "./unified-agent-list";

const store = vi.hoisted(() => ({
	agents: [] as AgentRow[],
	navigatedTo: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => (opts: Record<string, unknown>) => {
		store.navigatedTo.push(opts);
	},
	Link: ({
		children,
		...rest
	}: { children: ReactNode } & Record<string, unknown>) => (
		<a {...rest}>{children}</a>
	),
}));

function stubMutation<T>(result: T) {
	return (opts: Record<string, unknown>) => ({
		mutationFn: () => Promise.resolve(result),
		...opts,
	});
}

function query<T>(key: string[], read: () => T) {
	return {
		queryOptions: () => ({
			queryKey: key,
			queryFn: () => Promise.resolve(read()),
		}),
		key: () => key,
	};
}

function agentsMock() {
	return {
		list: query(["agents", "list"], () => store.agents),
		getToken: {
			queryOptions: ({ input }: { input: { id: string } }) => ({
				queryKey: ["agents", "getToken", input.id],
				queryFn: () => Promise.resolve("bt_cloudtoken"),
			}),
			key: () => ["agents", "getToken"],
		},
		create: {
			mutationOptions: stubMutation({ agent: { id: "x" }, token: "t" }),
		},
		update: { mutationOptions: stubMutation({ ok: true }) },
		delete: { mutationOptions: stubMutation({ ok: true }) },
		rotateToken: { mutationOptions: stubMutation({ token: "bt_rot" }) },
	};
}

vi.mock("@/utils/orpc", () => ({
	orpc: {
		agents: agentsMock(),
		memory: { listMemories: query(["memory", "listMemories"], () => []) },
	},
}));

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
	return {
		id: "agent-1",
		userId: "user-1",
		name: "cloud alpha",
		description: "",
		providerId: "anthropic",
		modelId: "claude-sonnet",
		systemPrompt: "",
		params: null,
		builtinTools: [],
		composioAccountIds: [],
		mcpServerIds: [],
		toolAllowlist: null,
		createdAt: new Date("2026-07-05T12:00:00Z"),
		updatedAt: new Date("2026-07-05T12:00:00Z"),
		...overrides,
	} as AgentRow;
}

function renderList(list: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>{list}</QueryClientProvider>
	);
	return { view: within(container) };
}

async function renderReadyTable(list: ReactElement) {
	const rendered = renderList(list);
	const table = await waitFor(() => within(rendered.view.getByRole("table")));
	return { ...rendered, table };
}

beforeEach(() => {
	store.agents = [makeAgent()];
	store.navigatedTo.length = 0;
});

afterEach(cleanup);

it("renders cloud rows with the full row-action cluster", async () => {
	const { table } = await renderReadyTable(<CloudAgentList />);

	expect(table.getByText("cloud alpha")).toBeDefined();
	expect(table.getByRole("button", { name: "Edit agent" })).toBeDefined();
	expect(table.getByRole("button", { name: "Regenerate token" })).toBeDefined();
});

it("cloud name navigates to /chat with the agent id", async () => {
	const { table } = await renderReadyTable(<CloudAgentList />);

	fireEvent.click(table.getByText("cloud alpha"));
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/chat",
		search: { agentId: "agent-1" },
	});
});

it("filters rows by name", async () => {
	store.agents = [
		makeAgent(),
		makeAgent({ id: "agent-2", name: "cloud gamma" }),
	];
	const { view, table } = await renderReadyTable(<CloudAgentList />);

	fireEvent.change(view.getByPlaceholderText("Search agents…"), {
		target: { value: "gamma" },
	});

	expect(table.getByText("cloud gamma")).toBeDefined();
	expect(table.queryByText("cloud alpha")).toBeNull();
});

it("offers the add entry point", async () => {
	const { view } = await renderReadyTable(<CloudAgentList />);
	expect(
		view.getAllByRole("button", { name: "Add agent" }).length
	).toBeGreaterThan(0);
});
