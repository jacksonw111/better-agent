// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalAgentWorkspace } from "./local-agent-workspace";
import {
	makeSession,
	makeToken,
	renderWorkspaceApp,
	resetWorkspaceStore,
	type SessionFixture,
	workspaceStore as store,
} from "./local-agent-workspace-test-utils";

// Flow-level coverage of the /local/$tokenId workspace (P2-T2 shell around
// the old LocalAgentDetail behaviors): latest-session selection, waiting-for-CLI,
// revoked-token not-found, and re-selection when the poll surfaces a newer
// session. P2-3 deleted the structured terminal — a legacy session (opened
// without a `?pty=` computer) now renders the "terminal moved" notice, and the
// selected session is observed via the sidebar row's `aria-current` marker.

vi.mock("@/utils/orpc", async () => {
	const mocks = await import("./local-agent-workspace-test-mocks");
	return mocks.buildOrpcMock();
});

const MOVED_NOTICE_PATTERN = /Terminal moved to the PTY terminal/;

/** The active session row carries `aria-current="true"` (not the "Rename …"
 * pencil, which has an aria-label). */
function activeRowText(view: ReturnType<typeof renderApp>["view"]) {
	return view
		.getAllByRole("button")
		.find(
			(button) =>
				button.getAttribute("aria-current") === "true" &&
				!button.hasAttribute("aria-label")
		)?.textContent;
}

const BASE_MS = new Date("2026-07-04T12:00:00Z").getTime();
const OLDER_MS = -1000;
const NEWER_MS = 60_000;
const at = (offsetMs: number) => new Date(BASE_MS + offsetMs);

function buildInitialSessions(): SessionFixture[] {
	return [
		makeSession({
			createdAt: at(0),
			id: "session-a",
			label: "alpha",
			lastSeenAt: at(0),
		}),
		makeSession({
			agentKind: "codex",
			createdAt: at(OLDER_MS),
			id: "session-b",
			label: "beta",
			lastSeenAt: at(OLDER_MS),
			status: "ended",
		}),
	];
}

// A newer session for the same token — stands in for "the CLI relaunched".
const NEWER_SESSION: SessionFixture = makeSession({
	createdAt: at(NEWER_MS),
	id: "session-c",
	label: "gamma",
	lastSeenAt: at(NEWER_MS),
});

function renderApp(initialEntry?: string) {
	return renderWorkspaceApp(LocalAgentWorkspace, initialEntry);
}

afterEach(cleanup);

beforeEach(() => {
	resetWorkspaceStore();
	store.sessions = buildInitialSessions();
	store.tokens = [
		makeToken({}),
		makeToken({
			id: "token-2",
			last4: "9999",
			name: "revoked agent",
			revokedAt: at(0),
			token: "bt_revoked",
		}),
	];
});

it("selects the token's latest session on load and shows the moved-terminal notice", async () => {
	const { view } = renderApp();

	// The workspace selected the token's LATEST session (session-a / alpha),
	// not the older ended session-b, and renders the PTY-moved notice for it.
	await waitFor(() => {
		expect(view.getByText(MOVED_NOTICE_PATTERN)).toBeDefined();
	});
	expect(activeRowText(view)).toContain("alpha");
	expect(activeRowText(view)).not.toContain("beta");
});

it("shows the waiting-for-CLI panel when the token has no session yet", async () => {
	store.sessions = [];
	const { view } = renderApp();

	await waitFor(() => {
		expect(view.getByText("Waiting for the CLI to connect")).toBeDefined();
	});
	expect(view.queryByText(MOVED_NOTICE_PATTERN)).toBeNull();
});

it("treats a revoked token as not found (keyed by token, excluded from entries)", async () => {
	const { view } = renderApp("/local/token-2");

	await waitFor(() => {
		expect(
			view.getByText(
				"This local agent wasn't found — it may have been removed, or the link is wrong."
			)
		).toBeDefined();
	});
});

it("re-selects onto a newer session when the poll picks one up for the same token", async () => {
	const { queryClient, view } = renderApp();

	await waitFor(() => {
		expect(activeRowText(view)).toContain("alpha");
	});

	// The CLI relaunched: a newer session appears for the same token.
	store.sessions = [...store.sessions, NEWER_SESSION];
	await queryClient.refetchQueries({ queryKey: ["bridge", "listSessions"] });

	// Selection follows the newest session (session-c / gamma), abandoning the
	// now-dead session-a.
	await waitFor(() => {
		expect(activeRowText(view)).toContain("gamma");
	});
});
