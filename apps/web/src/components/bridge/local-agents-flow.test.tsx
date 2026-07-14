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
// the old LocalAgentDetail behaviors): latest-session mount, waiting-for-CLI,
// revoked-token not-found, and remount when the poll surfaces a newer session.

vi.mock("@/utils/orpc", async () => {
	const mocks = await import("./local-agent-workspace-test-mocks");
	return mocks.buildOrpcMock();
});

vi.mock("./bridge-transport", async () => {
	const utils = await import("./local-agent-workspace-test-utils");
	return utils.buildTransportMock();
});

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

it("connects the terminal to the token's latest session on load", async () => {
	const { view } = renderApp();

	// The terminal mounted on the token's LATEST session (session-a), not the
	// older ended session-b.
	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-a");
	});
	expect(store.connectedSessionIds).not.toContain("session-b");
	expect(view.getByText("Connecting…")).toBeDefined();
});

it("gives the SessionView root the fill-height flex classes so the terminal's feed stays the sole scroller", async () => {
	const { container } = renderApp();

	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-a");
	});

	// SessionView's root wraps the (optional) remote-desktop panel + Terminal;
	// it must participate in the flex chain (min-h-0 flex-1) or the composer
	// can end up below the fold instead of pinned to the viewport bottom — see
	// Task 10.
	const sessionViewRoot = container.querySelector(
		".flex.min-h-0.flex-1.flex-col.gap-4"
	);
	expect(sessionViewRoot).not.toBeNull();
});

it("shows the waiting-for-CLI panel when the token has no session yet", async () => {
	store.sessions = [];
	const { view } = renderApp();

	await waitFor(() => {
		expect(view.getByText("Waiting for the CLI to connect")).toBeDefined();
	});
	expect(store.connectedSessionIds).toEqual([]);
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

it("remounts the terminal onto a newer session when the poll picks one up for the same token", async () => {
	const { queryClient } = renderApp();

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
