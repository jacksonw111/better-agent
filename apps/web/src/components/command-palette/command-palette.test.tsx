// @vitest-environment jsdom
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
import { afterEach, expect, it } from "vitest";
import { CommandPalette } from "./command-palette";
import {
	getCommandPaletteState,
	setCommandPaletteOpen,
} from "./command-palette-store";

// ⌘K palette behavior: open shortcut, Escape close, and "Go to" navigation.

// cmdk scrolls the selected item into view; jsdom doesn't implement it.
Element.prototype.scrollIntoView ??= () => {
	// no-op for jsdom
};

const DASHBOARD_PATTERN = /Dashboard/;
const ROOT_PLACEHOLDER = "Type a command or search…";

function buildPaletteRouter(initialEntry: string) {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<CommandPalette />
				<Outlet />
			</>
		),
	});
	const plainRoutes = ["/", "/dashboard", "/chat"].map((path) =>
		createRoute({
			component: () => null,
			getParentRoute: () => rootRoute,
			path,
		})
	);
	return createRouter({
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
		routeTree: rootRoute.addChildren(plainRoutes),
	});
}

async function renderPalette(initialEntry = "/") {
	const router = buildPaletteRouter(initialEntry);
	render(<RouterProvider router={router} />);
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

// No vitest globals, so testing-library's auto-cleanup never registers.
afterEach(() => {
	cleanup();
	setCommandPaletteOpen(false);
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

it("navigates to the selected page and closes", async () => {
	const router = await renderPalette();
	await openPalette();
	fireEvent.click(
		await screen.findByRole("option", { name: DASHBOARD_PATTERN })
	);
	await waitFor(() => {
		expect(router.state.location.pathname).toBe("/dashboard");
	});
	expect(getCommandPaletteState().open).toBe(false);
});
