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
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	makeSession,
	makeToken,
	resetWorkspaceStore,
	workspaceStore as store,
} from "../bridge/local-agent-workspace-test-utils";
import { CommandPalette } from "./command-palette";
import {
	getCommandPaletteState,
	registerWorkspaceCommandTarget,
	setCommandPaletteOpen,
} from "./command-palette-store";

// P2-T3: ⌘K palette behavior — open shortcut, agent/session navigation, the
// sessions sub-page (search + ?session= deep link), the page-stack Backspace
// pop, and workspace tab/settings items against a registered target.

vi.mock("@/utils/orpc", async () => {
	const mocks = await import("../bridge/local-agent-workspace-test-mocks");
	return mocks.buildOrpcMock();
});

// cmdk scrolls the selected item into view; jsdom doesn't implement it.
Element.prototype.scrollIntoView ??= () => {
	// no-op for jsdom
};

const BETA_AGENT_PATTERN = /beta agent/;
const SEARCH_SESSIONS_PATTERN = /Search sessions/;
const WORKING_AWAY_PATTERN = /working-away/;
const NEEDS_APPROVAL_PATTERN = /needs-approval/;
const DASHBOARD_PATTERN = /Dashboard/;
const FILES_TAB_PATTERN = /Switch to Files tab/;
const CHAT_TAB_PATTERN = /Switch to Chat tab/;
const AGENT_SETTINGS_PATTERN = /Agent settings/;
const ROOT_PLACEHOLDER = "Type a command or search…";
const SESSIONS_PLACEHOLDER = "Search sessions…";

function buildPaletteRouter(initialEntry: string) {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<CommandPalette />
				<Outlet />
			</>
		),
	});
	const plainRoutes = ["/", "/dashboard", "/local"].map((path) =>
		createRoute({
			component: () => null,
			getParentRoute: () => rootRoute,
			path,
		})
	);
	const detailRoute = createRoute({
		component: () => null,
		getParentRoute: () => rootRoute,
		path: "/local/$tokenId",
		validateSearch: (
			search: Record<string, unknown>
		): { session?: string } => ({
			session: typeof search.session === "string" ? search.session : undefined,
		}),
	});
	return createRouter({
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
		routeTree: rootRoute.addChildren([...plainRoutes, detailRoute]),
	});
}

async function renderPalette(initialEntry = "/") {
	const router = buildPaletteRouter(initialEntry);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
	// The router mounts its matched routes asynchronously; the palette (and
	// its ⌘K listener) only exists once that first mount settles.
	await act(async () => {
		await router.load();
	});
	return router;
}

async function openPalette() {
	act(() => setCommandPaletteOpen(true));
	await screen.findByRole("dialog");
}

const targetCleanups: (() => void)[] = [];

// No vitest globals, so testing-library's auto-cleanup never registers.
afterEach(() => {
	cleanup();
	for (const dispose of targetCleanups.splice(0)) {
		dispose();
	}
	setCommandPaletteOpen(false);
});

beforeEach(() => {
	resetWorkspaceStore();
	store.tokens = [makeToken({})];
	store.sessions = [
		makeSession({
			attention: "approval",
			id: "s-approval",
			label: "needs-approval",
		}),
		makeSession({ id: "s-working", label: "working-away" }),
	];
});

it("opens on ⌘K and closes on Escape", async () => {
	await renderPalette();
	fireEvent.keyDown(document, { key: "k", metaKey: true });
	const input = await screen.findByPlaceholderText(ROOT_PLACEHOLDER);
	fireEvent.keyDown(input, { key: "Escape" });
	await waitFor(() => {
		expect(screen.queryByPlaceholderText(ROOT_PLACEHOLDER)).toBeNull();
	});
	expect(getCommandPaletteState().open).toBe(false);
});

it("lists local agents and navigates to the selected one", async () => {
	store.tokens = [
		makeToken({}),
		makeToken({ id: "token-2", name: "beta agent", token: "bt_beta" }),
	];
	const router = await renderPalette();
	await openPalette();
	fireEvent.click(
		await screen.findByRole("option", { name: BETA_AGENT_PATTERN })
	);
	await waitFor(() => {
		expect(router.state.location.pathname).toBe("/local/token-2");
	});
	expect(getCommandPaletteState().open).toBe(false);
});

it("sessions sub-page filters by search and deep-links ?session=", async () => {
	const router = await renderPalette();
	await openPalette();
	fireEvent.click(
		await screen.findByRole("option", { name: SEARCH_SESSIONS_PATTERN })
	);
	await screen.findByRole("option", { name: WORKING_AWAY_PATTERN });
	const input = screen.getByPlaceholderText(SESSIONS_PLACEHOLDER);
	fireEvent.change(input, { target: { value: "needs" } });
	await waitFor(() => {
		expect(
			screen.queryByRole("option", { name: WORKING_AWAY_PATTERN })
		).toBeNull();
	});
	fireEvent.click(screen.getByRole("option", { name: NEEDS_APPROVAL_PATTERN }));
	await waitFor(() => {
		expect(router.state.location.pathname).toBe("/local/token-1");
	});
	expect(router.state.location.search).toEqual({ session: "s-approval" });
});

it("Backspace on an empty query pops back to the root page", async () => {
	await renderPalette();
	await openPalette();
	fireEvent.click(
		await screen.findByRole("option", { name: SEARCH_SESSIONS_PATTERN })
	);
	const input = await screen.findByPlaceholderText(SESSIONS_PLACEHOLDER);
	fireEvent.keyDown(input, { key: "Backspace" });
	await screen.findByPlaceholderText(ROOT_PLACEHOLDER);
	expect(screen.getByRole("option", { name: DASHBOARD_PATTERN })).toBeDefined();
});

it("workspace items switch tabs (P4 tabs disabled) and open settings", async () => {
	const setTab = vi.fn();
	const openSettings = vi.fn();
	targetCleanups.push(
		registerWorkspaceCommandTarget({
			openSettings,
			setTab,
			tab: "chat",
			tokenId: "token-1",
		})
	);
	await renderPalette("/local/token-1");
	await openPalette();
	const filesItem = await screen.findByRole("option", {
		name: FILES_TAB_PATTERN,
	});
	expect(filesItem.getAttribute("aria-disabled")).toBe("true");
	fireEvent.click(screen.getByRole("option", { name: CHAT_TAB_PATTERN }));
	expect(setTab).toHaveBeenCalledWith("chat");

	await openPalette();
	fireEvent.click(
		await screen.findByRole("option", { name: AGENT_SETTINGS_PATTERN })
	);
	expect(openSettings).toHaveBeenCalledTimes(1);
});
