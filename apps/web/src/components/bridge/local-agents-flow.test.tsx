// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LocalAgentDetail } from "./local-agent-detail";
import { LocalAgentList } from "./local-agent-list";

// Loose fixture shapes — just the fields the list/detail/join actually read.
interface SessionRow {
	agentKind: string;
	createdAt: Date;
	id: string;
	label: string;
	lastSeenAt: Date;
	status: string;
	tokenId: string;
	userId: string;
}
interface TokenRow {
	agentKind: string;
	createdAt: Date;
	id: string;
	last4: string;
	name: string;
	revokedAt: Date | null;
	token: string | null;
	userId: string;
}

// Mutable store shared with the (hoisted) vi.mock factories below. Kept tiny so
// the hoisted factory stays trivial; the bulky fixtures are built at top level
// and refreshed per test in `beforeEach`.
const store = vi.hoisted(() => ({
	connectedSessionIds: [] as string[],
	sessions: [] as SessionRow[],
	tokens: [] as TokenRow[],
}));

const BASE_MS = new Date("2026-07-04T12:00:00Z").getTime();
const OLDER_MS = -1000;
const NEWER_MS = 60_000;
const at = (offsetMs: number) => new Date(BASE_MS + offsetMs);

function buildInitialSessions(): SessionRow[] {
	return [
		{
			id: "session-a",
			userId: "user-1",
			tokenId: "token-1",
			agentKind: "claude-code",
			label: "alpha",
			status: "active",
			createdAt: at(0),
			lastSeenAt: at(0),
		},
		{
			id: "session-b",
			userId: "user-1",
			tokenId: "token-1",
			agentKind: "codex",
			label: "beta",
			status: "ended",
			createdAt: at(OLDER_MS),
			lastSeenAt: at(OLDER_MS),
		},
	];
}

// A newer session for the same token — stands in for "the CLI relaunched".
const NEWER_SESSION: SessionRow = {
	id: "session-c",
	userId: "user-1",
	tokenId: "token-1",
	agentKind: "claude-code",
	label: "gamma",
	status: "active",
	createdAt: at(NEWER_MS),
	lastSeenAt: at(NEWER_MS),
};

function buildTokens(): TokenRow[] {
	return [
		{
			id: "token-1",
			userId: "user-1",
			name: "alpha agent",
			agentKind: "claude-code",
			token: "bt_alpha",
			last4: "1234",
			createdAt: at(0),
			revokedAt: null,
		},
		{
			id: "token-2",
			userId: "user-1",
			name: "revoked agent",
			agentKind: "claude-code",
			token: "bt_revoked",
			last4: "9999",
			createdAt: at(0),
			revokedAt: at(0),
		},
	];
}

// Small factory so each stubbed mutation doesn't need its own multi-line
// mutationOptions boilerplate (keeps the vi.mock factory below under the
// max-lines-per-function cap).
function stubMutation<T>(result: T) {
	return (opts: Record<string, unknown>) => ({
		mutationFn: () => Promise.resolve(result),
		...opts,
	});
}

vi.mock("@/utils/orpc", () => {
	const listSessionsKey = ["bridge", "listSessions"];
	const listTokensKey = ["bridge", "listTokens"];
	const meKey = ["auth", "me"];
	return {
		orpc: {
			auth: {
				me: {
					queryOptions: () => ({
						queryKey: meKey,
						queryFn: () => Promise.resolve({ email: "tester@example.com" }),
					}),
				},
			},
			bridge: {
				listSessions: {
					queryOptions: () => ({
						queryKey: listSessionsKey,
						queryFn: () => Promise.resolve(store.sessions),
					}),
					key: () => listSessionsKey,
				},
				listTokens: {
					queryOptions: () => ({
						queryKey: listTokensKey,
						queryFn: () => Promise.resolve(store.tokens),
					}),
					key: () => listTokensKey,
				},
				createToken: {
					mutationOptions: stubMutation({
						id: "new-token",
						token: "bt_new",
						last4: "_new",
					}),
				},
				endSession: {
					mutationOptions: stubMutation({ ok: true }),
				},
				deleteToken: {
					mutationOptions: stubMutation({ ok: true }),
				},
			},
		},
	};
});

// A recording fake so we can observe which session the terminal connected to.
// A newer session id in `connectedSessionIds` is proof the terminal remounted
// (the SSE connect effect re-ran for a fresh session), not just re-rendered.
vi.mock("./bridge-transport", () => ({
	createBridgeTransport: () => ({
		connectStream: (args: { sessionId: string }) => {
			store.connectedSessionIds.push(args.sessionId);
			return () => {
				// no cleanup needed for this fake
			};
		},
		history: () => Promise.resolve([]),
		observe: () => Promise.resolve([]),
		sendInput: () => Promise.resolve(),
	}),
}));

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
	component: LocalAgentList,
	getParentRoute: () => rootRoute,
	path: "/local-agents/",
});
const detailRoute = createRoute({
	component: DetailRouteComponent,
	getParentRoute: () => rootRoute,
	path: "/local-agents/$tokenId",
});

function DetailRouteComponent() {
	const { tokenId } = detailRoute.useParams();
	return <LocalAgentDetail tokenId={tokenId} />;
}

function buildTestRouter(initialEntry = "/local-agents/") {
	const routeTree = rootRoute.addChildren([indexRoute, detailRoute]);
	return createRouter({
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
		routeTree,
	});
}

function renderApp(router: ReturnType<typeof buildTestRouter>) {
	const queryClient = new QueryClient();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
	return { queryClient, view: within(container) };
}

beforeEach(() => {
	store.connectedSessionIds.length = 0;
	store.sessions = buildInitialSessions();
	store.tokens = buildTokens();
});

it("shows one table row per non-revoked token and opens its token-keyed detail", async () => {
	const router = buildTestRouter();
	const { view } = renderApp(router);

	// Rendered as a real table with an Actions column. jsdom applies no CSS, so
	// both the <md card list and the desktop table are present in the DOM —
	// scope queries to the table to avoid ambiguous duplicate matches.
	await waitFor(() => {
		expect(view.getByRole("table")).toBeDefined();
	});
	const table = within(view.getByRole("table"));
	// One row for token-1, the revoked token has none.
	expect(table.getByText("alpha agent")).toBeDefined();
	expect(table.queryByText("revoked agent")).toBeNull();
	expect(table.getByRole("columnheader", { name: "Actions" })).toBeDefined();

	fireEvent.click(table.getByText("alpha agent"));

	await waitFor(() => {
		expect(router.state.location.pathname).toBe("/local-agents/token-1");
	});
	// The terminal mounted on the token's LATEST session (session-a), not the
	// older ended session-b.
	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-a");
	});
	expect(store.connectedSessionIds).not.toContain("session-b");
	expect(view.getByText("Connecting…")).toBeDefined();
});

it("keeps the row when the token has no session yet (keyed by token, not session)", async () => {
	store.sessions = [];
	const router = buildTestRouter();
	const { view } = renderApp(router);

	await waitFor(() => {
		expect(view.getByRole("table")).toBeDefined();
	});
	const table = within(view.getByRole("table"));
	expect(table.getByText("alpha agent")).toBeDefined();
	expect(table.getByText("Claude Code")).toBeDefined();
	expect(table.getByText("Not connected")).toBeDefined();
});

it("remounts the terminal onto a newer session when the poll picks one up for the same token", async () => {
	const router = buildTestRouter("/local-agents/token-1");
	const { queryClient } = renderApp(router);

	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-a");
	});
	expect(store.connectedSessionIds).not.toContain("session-c");

	// The CLI relaunched: a newer session appears for the same token.
	store.sessions = [...store.sessions, NEWER_SESSION];
	await queryClient.refetchQueries({ queryKey: ["bridge", "listSessions"] });

	// The terminal must remount onto session-c (new SSE connect), abandoning
	// the now-dead session-a.
	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-c");
	});
});
