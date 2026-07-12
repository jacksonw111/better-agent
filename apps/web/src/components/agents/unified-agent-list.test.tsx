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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
	AgentRow,
	BridgeSessionRow,
	BridgeTokenRow,
} from "@/utils/api-types";
import { UnifiedAgentList } from "./unified-agent-list";

const store = vi.hoisted(() => ({
	agents: [] as AgentRow[],
	tokens: [] as BridgeTokenRow[],
	sessions: [] as BridgeSessionRow[],
	agentsError: false,
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
		list: {
			queryOptions: () => ({
				queryKey: ["agents", "list"],
				queryFn: () =>
					store.agentsError
						? Promise.reject(new Error("boom"))
						: Promise.resolve(store.agents),
			}),
			key: () => ["agents", "list"],
		},
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
		listSessions: query(["bridge", "listSessions"], () => store.sessions),
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

function renderList() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<UnifiedAgentList />
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		view: within(container),
	};
}

async function renderReadyTable() {
	const rendered = renderList();
	const table = await waitFor(() => within(rendered.view.getByRole("table")));
	return { ...rendered, table };
}

beforeEach(() => {
	store.agents = [makeAgent()];
	store.tokens = [makeToken()];
	store.sessions = [];
	store.agentsError = false;
	store.navigatedTo.length = 0;
});

afterEach(cleanup);

it("renders rows from both sources with a type badge each", async () => {
	const { table } = await renderReadyTable();

	expect(table.getByText("cloud alpha")).toBeDefined();
	expect(table.getByText("local beta")).toBeDefined();
	expect(table.getByText("Cloud Agent")).toBeDefined();
	expect(table.getByText("Local Agent")).toBeDefined();
});

it("cloud name navigates to /chat and cloud rows get full row actions", async () => {
	const { table } = await renderReadyTable();

	fireEvent.click(table.getByText("cloud alpha"));
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/chat",
		search: { agentId: "agent-1" },
	});
	// Cloud rows carry the edit/regenerate cluster; local rows only delete.
	expect(table.getByRole("button", { name: "Edit agent" })).toBeDefined();
	expect(table.getByRole("button", { name: "Regenerate token" })).toBeDefined();
	// The token-less local entry shows its status chip.
	expect(table.getByText("Not connected")).toBeDefined();
});

it("local name navigates directly to /chat with the token as localAgentId", async () => {
	const { table } = await renderReadyTable();

	fireEvent.click(table.getByText("local beta"));
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/chat",
		search: { localAgentId: "token-1" },
	});
});

it("keeps local rows when the cloud query errors", async () => {
	store.agentsError = true;
	const { table } = await renderReadyTable();

	await waitFor(() => {
		expect(table.getByText("local beta")).toBeDefined();
	});
	expect(table.queryByText("cloud alpha")).toBeNull();
});

it("filters to only local rows when searching 'local'", async () => {
	const { view, table } = await renderReadyTable();

	fireEvent.change(view.getByPlaceholderText("Search agents…"), {
		target: { value: "local" },
	});

	expect(table.getByText("local beta")).toBeDefined();
	expect(table.queryByText("cloud alpha")).toBeNull();
});

it("offers both agent types in the Add menu", async () => {
	const { body, view } = await renderReadyTable();

	fireEvent.click(view.getAllByRole("button", { name: "Add agent" })[0]);

	expect(body.getByRole("menuitem", { name: "Cloud Agent" })).toBeDefined();
	expect(body.getByRole("menuitem", { name: "Local Agent" })).toBeDefined();
});
