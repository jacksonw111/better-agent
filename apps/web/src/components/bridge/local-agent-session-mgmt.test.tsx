// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalAgentWorkspace } from "./local-agent-workspace";
import {
	makeSession,
	makeToken,
	renderWorkspaceApp,
	resetWorkspaceStore,
	workspaceStore as store,
} from "./local-agent-workspace-test-utils";

// P3-T1: persisted session management through the sidebar — star pinning, the
// three-option delete flow (archive / delete permanently / cancel), and the
// archived view (list + restore + delete). Rename persistence lives in
// local-agent-workspace.test.tsx next to the original rename-shell test.

vi.mock("@/utils/orpc", async () => {
	const mocks = await import("./local-agent-workspace-test-mocks");
	return mocks.buildOrpcMock();
});

vi.mock("./bridge-transport", async () => {
	const utils = await import("./local-agent-workspace-test-utils");
	return utils.buildTransportMock();
});

const NOW_MS = Date.now();
const MINUTE_MS = 60_000;
const MINUTES_2 = 120_000;
const ROW_TITLE_PATTERN = /^[a-z]+-run$/;

// No vitest `globals`, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

beforeEach(() => {
	resetWorkspaceStore();
	store.sessions = [
		makeSession({ id: "s-new", label: "newest-run" }),
		makeSession({
			createdAt: new Date(NOW_MS - MINUTE_MS),
			id: "s-mid",
			label: "middle-run",
		}),
		makeSession({
			createdAt: new Date(NOW_MS - MINUTES_2),
			id: "s-old",
			label: "oldest-run",
			starred: true,
		}),
	];
	store.tokens = [makeToken({})];
});

/** Menus/dialogs portal to document.body (outside the render container), so
 * interactions scope to the body — same pattern as the session-picker test. */
function renderApp(initialEntry?: string) {
	const rendered = renderWorkspaceApp(LocalAgentWorkspace, initialEntry);
	return { ...rendered, body: within(document.body) };
}

/** Sidebar row titles in visual order — matched as exact text nodes so the
 * rows' sr-only signal labels and the action buttons' aria-labels don't
 * pollute the result. */
function rowTitles(view: ReturnType<typeof renderApp>["view"]): string[] {
	return view
		.getAllByText(ROW_TITLE_PATTERN)
		.map((element) => element.textContent ?? "");
}

it("pins starred sessions to the top, keeping recency within groups", async () => {
	const { view } = renderApp();
	await waitFor(() => {
		expect(view.getByText("oldest-run")).toBeDefined();
	});
	expect(rowTitles(view)).toEqual(["oldest-run", "newest-run", "middle-run"]);
});

it("the star toggle persists via starSession and re-pins the list", async () => {
	const { view } = renderApp();
	await waitFor(() => {
		expect(view.getByText("middle-run")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: "Star middle-run" }));

	await waitFor(() => {
		expect(store.mgmtCalls).toContainEqual({
			route: "starSession",
			input: { sessionId: "s-mid", starred: true },
		});
	});
	// Both starred rows pin above the unstarred one, newest starred first.
	await waitFor(() => {
		expect(rowTitles(view)).toEqual(["middle-run", "oldest-run", "newest-run"]);
	});
});

it("the ⋯ menu offers archive / delete permanently / cancel; delete confirms first", async () => {
	const { body, view } = renderApp();
	await waitFor(() => {
		expect(view.getByText("middle-run")).toBeDefined();
	});

	fireEvent.click(
		view.getByRole("button", { name: "More actions for middle-run" })
	);
	expect(body.getByText("Archive")).toBeDefined();
	expect(body.getByText("Cancel")).toBeDefined();
	fireEvent.click(body.getByText("Delete permanently"));

	// Nothing deleted yet — the confirm dialog gates the destructive action.
	expect(store.mgmtCalls).toEqual([]);
	fireEvent.click(body.getByRole("button", { name: "Delete permanently" }));

	await waitFor(() => {
		expect(store.mgmtCalls).toContainEqual({
			route: "deleteSession",
			input: { sessionId: "s-mid" },
		});
	});
	await waitFor(() => {
		expect(view.queryByText("middle-run")).toBeNull();
	});
});

it("archiving the ACTIVE session moves selection to the newest remaining one", async () => {
	const { body, router, view } = renderApp("/local/token-1?session=s-new");
	await waitFor(() => {
		expect(view.getByText("newest-run")).toBeDefined();
	});

	fireEvent.click(
		view.getByRole("button", { name: "More actions for newest-run" })
	);
	fireEvent.click(body.getByText("Archive"));

	await waitFor(() => {
		expect(store.mgmtCalls).toContainEqual({
			route: "archiveSession",
			input: { sessionId: "s-new" },
		});
	});
	await waitFor(() => {
		expect(router.state.location.search).toEqual({ session: "s-mid" });
	});
	await waitFor(() => {
		expect(view.queryByText("newest-run")).toBeNull();
	});
});

it("the archived view lists archived sessions and restores them to the main list", async () => {
	store.sessions.push(
		makeSession({
			archivedAt: new Date(NOW_MS - MINUTE_MS),
			id: "s-archived",
			label: "shelved-run",
			status: "ended",
		})
	);
	const { view } = renderApp();
	await waitFor(() => {
		expect(view.getByText("newest-run")).toBeDefined();
	});
	expect(view.queryByText("shelved-run")).toBeNull();

	fireEvent.click(view.getByRole("button", { name: "Archived" }));
	await waitFor(() => {
		expect(view.getByText("shelved-run")).toBeDefined();
	});
	expect(
		view.getByRole("button", { name: "Delete shelved-run" })
	).toBeDefined();

	fireEvent.click(view.getByRole("button", { name: "Restore shelved-run" }));
	await waitFor(() => {
		expect(store.mgmtCalls).toContainEqual({
			route: "restoreSession",
			input: { sessionId: "s-archived" },
		});
	});
	await waitFor(() => {
		expect(view.getByText("No archived sessions.")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: "Back to sessions" }));
	await waitFor(() => {
		expect(view.getByText("shelved-run")).toBeDefined();
	});
});
