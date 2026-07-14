import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	useNavigate,
} from "@tanstack/react-router";
import { render, within } from "@testing-library/react";
import type { ComponentType } from "react";

// Shared harness for local-agent-workspace.test.tsx and
// local-agents-flow.test.tsx — mutable store + mock builders + a router that
// mirrors routes/local.$tokenId.tsx. Split out so neither test file trips the
// repo's 300-line file cap (same precedent as terminal-test-helpers.tsx). Not
// a `*.test.*` file, so vitest's include glob skips it. Deliberately imports
// NO app modules (only test infra), so the test files' `vi.mock` factories can
// `await import(...)` it without a mock-resolution cycle.

export interface SessionFixture {
	agentKind: string;
	archivedAt: Date | null;
	attention: "approval" | "processing" | null;
	createdAt: Date;
	id: string;
	label: string;
	lastSeenAt: Date;
	name: string | null;
	starred: boolean;
	status: string;
	tokenId: string;
	userId: string;
}

export interface TokenFixture {
	agentKind: string;
	createdAt: Date;
	id: string;
	last4: string;
	name: string;
	revokedAt: Date | null;
	token: string | null;
	userId: string;
}

/** One mutable store per test FILE (vitest isolates module registries), reset
 * per test via `resetWorkspaceStore`. Shared between the test body (fixtures,
 * assertions) and the `vi.mock` factories (reads). */
export const workspaceStore = {
	connectedSessionIds: [] as string[],
	firstNextCursor: null as string | null,
	loadMoreCursors: [] as string[],
	// P3-T1: every session-mgmt mutation call, in order — route name + input.
	mgmtCalls: [] as { route: string; input: Record<string, unknown> }[],
	olderPage: { nextCursor: null as string | null, sessions: [] as unknown[] },
	sessions: [] as SessionFixture[],
	tokens: [] as TokenFixture[],
};

export function resetWorkspaceStore(): void {
	workspaceStore.connectedSessionIds.length = 0;
	workspaceStore.firstNextCursor = null;
	workspaceStore.loadMoreCursors.length = 0;
	workspaceStore.mgmtCalls.length = 0;
	workspaceStore.olderPage = { nextCursor: null, sessions: [] };
	workspaceStore.sessions = [];
	workspaceStore.tokens = [];
}

export function makeSession(
	overrides: Partial<SessionFixture>
): SessionFixture {
	const now = new Date();
	return {
		agentKind: "claude-code",
		archivedAt: null,
		attention: null,
		createdAt: now,
		id: "session-x",
		label: "session-x",
		lastSeenAt: now,
		name: null,
		starred: false,
		status: "active",
		tokenId: "token-1",
		userId: "user-1",
		...overrides,
	};
}

export function makeToken(overrides: Partial<TokenFixture>): TokenFixture {
	return {
		agentKind: "claude-code",
		createdAt: new Date(),
		id: "token-1",
		last4: "1234",
		name: "alpha agent",
		revokedAt: null,
		token: "bt_alpha",
		userId: "user-1",
		...overrides,
	};
}

/** The `./bridge-transport` mock — records which session each mounted
 * terminal connected to. A NEW session id appearing in `connectedSessionIds`
 * is proof the terminal remounted (fresh connect), not just re-rendered. */
export function buildTransportMock() {
	return {
		createBridgeTransport: () => ({
			connectStream: (args: { sessionId: string }) => {
				workspaceStore.connectedSessionIds.push(args.sessionId);
				return () => {
					// unsubscribe: no-op for this fake
				};
			},
			history: () => Promise.resolve([]),
			observe: () => Promise.resolve([]),
			sendInput: () => Promise.resolve(),
		}),
	};
}

export interface WorkspaceProps {
	onSelectSession: (sessionId: string) => void;
	sessionId: string | undefined;
	tokenId: string;
}

/** Builds a memory router mirroring routes/local.$tokenId.tsx (`?session=`
 * in, `navigate({ search, replace })` out) around the given workspace
 * component — passed in (rather than imported) to keep this module free of
 * app imports. Includes a stub `/local` route so the sidebar's back link
 * resolves. */
function buildWorkspaceRouter(
	Workspace: ComponentType<WorkspaceProps>,
	initialEntry: string
) {
	const rootRoute = createRootRoute({ component: Outlet });
	const listRoute = createRoute({
		component: () => null,
		getParentRoute: () => rootRoute,
		path: "/local",
	});
	const detailRoute = createRoute({
		component: DetailRouteComponent,
		getParentRoute: () => rootRoute,
		path: "/local/$tokenId",
		validateSearch: (
			search: Record<string, unknown>
		): { session?: string } => ({
			session: typeof search.session === "string" ? search.session : undefined,
		}),
	});
	function DetailRouteComponent() {
		const { tokenId } = detailRoute.useParams();
		const { session } = detailRoute.useSearch();
		const navigate = useNavigate();
		return (
			<Workspace
				onSelectSession={(sessionId) =>
					navigate({
						params: { tokenId },
						replace: true,
						search: { session: sessionId },
						to: "/local/$tokenId",
					})
				}
				sessionId={session}
				tokenId={tokenId}
			/>
		);
	}
	return createRouter({
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
		routeTree: rootRoute.addChildren([listRoute, detailRoute]),
	});
}

export function renderWorkspaceApp(
	Workspace: ComponentType<WorkspaceProps>,
	initialEntry = "/local/token-1"
) {
	const router = buildWorkspaceRouter(Workspace, initialEntry);
	const queryClient = new QueryClient();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
	return { container, queryClient, router, view: within(container) };
}
