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
import type {
	AgentRow,
	BridgeSessionRow,
	BridgeTokenRow,
} from "@/utils/api-types";
import { CloudAgentList, LocalAgentList } from "./unified-agent-list";

const store = vi.hoisted(() => ({
	agents: [] as AgentRow[],
	tokens: [] as BridgeTokenRow[],
	sessions: [] as BridgeSessionRow[],
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

function bridgeMock() {
	return {
		listTokens: query(["bridge", "listTokens"], () => store.tokens),
		listSessions: query(["bridge", "listSessions"], () => ({
			sessions: store.sessions,
			nextCursor: null,
		})),
		deleteToken: { mutationOptions: stubMutation({ ok: true }) },
		createToken: {
			mutationOptions: stubMutation({
				id: "new-token",
				token: "bt_new",
				last4: "_new",
			}),
		},
	};
}

vi.mock("@/utils/orpc", () => ({
	orpc: {
		agents: agentsMock(),
		bridge: bridgeMock(),
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

function makeToken(overrides: Partial<BridgeTokenRow> = {}): BridgeTokenRow {
	return {
		id: "token-1",
		userId: "user-1",
		name: "local beta",
		agentKind: "claude-code",
		token: "bt_beta",
		last4: "1234",
		config: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		revokedAt: null,
		...overrides,
	};
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
	store.tokens = [makeToken()];
	store.sessions = [];
	store.navigatedTo.length = 0;
});

afterEach(cleanup);

it("cloud list renders only cloud rows, with the full row-action cluster", async () => {
	const { table } = await renderReadyTable(<CloudAgentList />);

	expect(table.getByText("cloud alpha")).toBeDefined();
	expect(table.queryByText("local beta")).toBeNull();
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

it("local list renders only local rows, with the status chip", async () => {
	const { table } = await renderReadyTable(<LocalAgentList />);

	expect(table.getByText("local beta")).toBeDefined();
	expect(table.queryByText("cloud alpha")).toBeNull();
	// The token-less local entry shows its status chip.
	expect(table.getByText("Not connected")).toBeDefined();
});

it("local name navigates to the /local workspace with the token id", async () => {
	const { table } = await renderReadyTable(<LocalAgentList />);

	fireEvent.click(table.getByText("local beta"));
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/local/$tokenId",
		params: { tokenId: "token-1" },
	});
});

it("filters local rows by name", async () => {
	store.tokens = [
		makeToken(),
		makeToken({ id: "token-2", name: "gamma", last4: "5678" }),
	];
	const { view, table } = await renderReadyTable(<LocalAgentList />);

	fireEvent.change(view.getByPlaceholderText("Search agents…"), {
		target: { value: "gamma" },
	});

	expect(table.getByText("gamma")).toBeDefined();
	expect(table.queryByText("local beta")).toBeNull();
});

it("each page offers its own add entry point", async () => {
	const cloud = await renderReadyTable(<CloudAgentList />);
	expect(
		cloud.view.getAllByRole("button", { name: "Add agent" }).length
	).toBeGreaterThan(0);
	cleanup();

	const local = await renderReadyTable(<LocalAgentList />);
	expect(
		local.view.getAllByRole("button", { name: "Connect agent" }).length
	).toBeGreaterThan(0);
});
