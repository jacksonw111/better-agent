// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	getCommandPaletteState,
	setCommandPaletteOpen,
} from "@/components/command-palette/command-palette-store";
import { LocalAgentWorkspace } from "./local-agent-workspace";
import {
	makeSession,
	makeToken,
	renderWorkspaceApp,
	resetWorkspaceStore,
	workspaceStore as store,
} from "./local-agent-workspace-test-utils";

// P2-T2 workspace shell: sidebar signals, ?session= routing, load-more
// pagination, the rename shell, and the tab row. The flow-level basics
// (latest-session mount, waiting/not-found, remount on newer session) stay in
// local-agents-flow.test.tsx.

vi.mock("@/utils/orpc", async () => {
	const mocks = await import("./local-agent-workspace-test-mocks");
	return mocks.buildOrpcMock();
});

const NOW_MS = Date.now();
const MINUTE_MS = 60_000;
const MINUTES_2 = 120_000;
const MINUTES_3 = 180_000;
const MINUTES_10 = 600_000;
const STILL_LIVE_PATTERN = /still-live/;

/** Newest-first: approval, processing, live, ended — one of each signal. */
function buildSignalSessions() {
	return [
		makeSession({
			attention: "approval",
			id: "s-approval",
			label: "needs-approval",
		}),
		makeSession({
			attention: "processing",
			createdAt: new Date(NOW_MS - MINUTE_MS),
			id: "s-processing",
			label: "working-away",
		}),
		makeSession({
			createdAt: new Date(NOW_MS - MINUTES_2),
			id: "s-live",
			label: "still-live",
		}),
		makeSession({
			createdAt: new Date(NOW_MS - MINUTES_3),
			id: "s-ended",
			label: "done-ended",
			lastSeenAt: new Date(NOW_MS - MINUTES_3),
			status: "ended",
		}),
	];
}

function renderApp(initialEntry?: string) {
	return renderWorkspaceApp(LocalAgentWorkspace, initialEntry);
}

// No vitest `globals`, so testing-library's auto-cleanup never registers —
// without this, an earlier test's still-mounted terminal keeps reconnecting
// (SSE retry timers) and pollutes `connectedSessionIds` across tests.
afterEach(() => {
	cleanup();
	setCommandPaletteOpen(false);
});

beforeEach(() => {
	resetWorkspaceStore();
	store.sessions = buildSignalSessions();
	store.tokens = [makeToken({})];
});

it("renders one signal per sidebar row: approval pulse, working spinner, live, ended", async () => {
	const { container, view } = renderApp();
	await waitFor(() => {
		expect(view.getByText("needs-approval")).toBeDefined();
	});
	for (const title of ["Waiting for approval", "Working", "Live", "Ended"]) {
		expect(container.querySelector(`[title="${title}"]`)).not.toBeNull();
	}
});

/** The active session row carries `aria-current="true"` — the observable that
 * replaced the deleted terminal's connect signal (P2-3). Finds the row button
 * (not its "Rename …" pencil, which carries an aria-label). */
function activeRow(view: ReturnType<typeof renderApp>["view"]) {
	return view
		.getAllByRole("button")
		.find(
			(button) =>
				button.getAttribute("aria-current") === "true" &&
				!button.hasAttribute("aria-label")
		);
}

it("selects the session named by ?session= instead of the newest", async () => {
	const { view } = renderApp("/local/token-1?session=s-live");
	await waitFor(() => {
		expect(activeRow(view)?.textContent).toContain("still-live");
	});
	expect(activeRow(view)?.textContent).not.toContain("needs-approval");
	expect(view.getByText("needs-approval")).toBeDefined();
});

it("clicking a sidebar row writes ?session= and marks it active", async () => {
	const { router, view } = renderApp();
	await waitFor(() => {
		expect(activeRow(view)?.textContent).toContain("needs-approval");
	});

	// Two buttons mention the label: the row itself and its "Rename …" pencil
	// (which carries an aria-label) — click the row.
	const row = view
		.getAllByRole("button", { name: STILL_LIVE_PATTERN })
		.find((button) => !button.hasAttribute("aria-label"));
	if (!row) {
		throw new Error("session row for still-live not found");
	}
	fireEvent.click(row);

	await waitFor(() => {
		expect(router.state.location.search).toEqual({ session: "s-live" });
	});
	expect(activeRow(view)?.textContent).toContain("still-live");
});

it("Load more appends the older page and hides the button once exhausted", async () => {
	store.firstNextCursor = "cursor-1";
	store.olderPage = {
		nextCursor: null,
		sessions: [
			makeSession({
				createdAt: new Date(NOW_MS - MINUTES_10),
				id: "s-old",
				label: "paged-old",
				lastSeenAt: new Date(NOW_MS - MINUTES_10),
				status: "ended",
			}),
		],
	};
	const { view } = renderApp();
	const loadMore = await waitFor(() =>
		view.getByRole("button", { name: "Load more" })
	);

	fireEvent.click(loadMore);

	await waitFor(() => {
		expect(view.getByText("paged-old")).toBeDefined();
	});
	expect(store.loadMoreCursors).toEqual(["cursor-1"]);
	expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("rename persists via the renameSession mutation and updates the row", async () => {
	const { view } = renderApp();
	await waitFor(() => {
		expect(view.getByText("still-live")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: "Rename still-live" }));
	const input = view.getByRole("textbox", { name: "Session name" });
	fireEvent.change(input, { target: { value: "my renamed session" } });
	fireEvent.keyDown(input, { key: "Enter" });

	await waitFor(() => {
		expect(view.getByText("my renamed session")).toBeDefined();
	});
	expect(view.queryByText("still-live")).toBeNull();
	expect(store.mgmtCalls).toEqual([
		{
			route: "renameSession",
			input: { sessionId: "s-live", name: "my renamed session" },
		},
	]);
	expect(store.sessions.find((s) => s.id === "s-live")?.name).toBe(
		"my renamed session"
	);
});

it("renders only the Chat tab — Files/Git/Shell gated pending thin-RPC rewire (P2-3)", async () => {
	const { view } = renderApp();
	await waitFor(() => {
		expect(view.getByRole("tab", { name: "Chat" })).toBeDefined();
	});
	expect(
		view.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")
	).toBe("true");
	// The inspection panes were fed by the deleted structured channel; their
	// tabs stay hidden until rewired onto a thin RPC transport.
	for (const gatedName of ["Shell", "Files", "Git"]) {
		expect(view.queryByRole("tab", { name: gatedName })).toBeNull();
	}
});

it("registers the palette's workspace target while mounted, clears it on unmount", async () => {
	const { view } = renderApp();
	await waitFor(() => {
		expect(getCommandPaletteState().workspace?.tokenId).toBe("token-1");
	});
	expect(getCommandPaletteState().workspace?.tab).toBe("chat");

	fireEvent.click(view.getByRole("button", { name: "Open command palette" }));
	expect(getCommandPaletteState().open).toBe(true);

	cleanup();
	expect(getCommandPaletteState().workspace).toBeNull();
});

it("shows waiting-for-CLI in the content pane with the (empty) sidebar still visible", async () => {
	store.sessions = [];
	const { container, view } = renderApp();
	await waitFor(() => {
		expect(view.getByText("Waiting for the CLI to connect")).toBeDefined();
	});
	const nav = container.querySelector('nav[aria-label="Sessions"]');
	expect(nav).not.toBeNull();
	expect(
		within(nav as HTMLElement).getByText("No sessions yet.")
	).toBeDefined();
	expect(store.connectedSessionIds).toEqual([]);
});
