// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// DP-WS: the Files and Git panes reuse the project cards' tested presentation, so
// these tests only cover the wiring: a happy render and the inline error state.
// The pane shell (workspace gate) is stubbed to a passthrough.

const store = vi.hoisted(() => ({
	fsQueryFn: vi.fn(),
	gitQueryFn: vi.fn(),
}));

vi.mock("./workspace-pane-shell", () => ({
	WorkspacePaneShell: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("./workspace-query", () => ({
	workspaceFsListOptions: (sessionId: string, path: string) => ({
		queryFn: () => store.fsQueryFn(sessionId, path),
		queryKey: ["fs", sessionId, path],
	}),
	workspaceGitStatusOptions: (sessionId: string) => ({
		queryFn: () => store.gitQueryFn(sessionId),
		queryKey: ["git", sessionId],
	}),
}));

const { WorkspaceFilesPane } = await import("./workspace-files-pane");
const { WorkspaceGitPane } = await import("./workspace-git-pane");

afterEach(() => {
	cleanup();
	store.fsQueryFn.mockReset();
	store.gitQueryFn.mockReset();
});

const PATH_ESCAPE_TEXT = /path escapes the workspace/;
const RETRY_BUTTON = /retry/i;
const NOT_A_REPO_TEXT = /not a git repository/;

function wrap(node: React.ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{node}</QueryClientProvider>
	);
}

it("Files pane renders the workspace entries", async () => {
	store.fsQueryFn.mockResolvedValue({
		entries: [
			{ kind: "dir", name: "src" },
			{ kind: "file", name: "README.md", size: 12 },
		],
	});
	wrap(<WorkspaceFilesPane sessionId="session-1" />);
	await waitFor(() => {
		expect(screen.getByText("README.md")).toBeTruthy();
	});
	expect(screen.getByText("src")).toBeTruthy();
});

it("Files pane shows the inline error with a retry", async () => {
	store.fsQueryFn.mockRejectedValue(new Error("path escapes the workspace"));
	wrap(<WorkspaceFilesPane sessionId="session-1" />);
	await waitFor(() => {
		expect(screen.getByText(PATH_ESCAPE_TEXT)).toBeTruthy();
	});
	expect(screen.getByRole("button", { name: RETRY_BUTTON })).toBeTruthy();
});

it("Git pane renders the branch and changes", async () => {
	store.gitQueryFn.mockResolvedValue({
		branch: "main",
		changes: [{ path: "a.txt", status: " M" }],
		dirty: true,
		lastCommit: { hash: "abcdef0", subject: "init" },
	});
	wrap(<WorkspaceGitPane sessionId="session-1" />);
	await waitFor(() => {
		expect(screen.getByText("main")).toBeTruthy();
	});
	expect(screen.getByText("a.txt")).toBeTruthy();
});

it("Git pane shows the inline error", async () => {
	store.gitQueryFn.mockRejectedValue(new Error("not a git repository"));
	wrap(<WorkspaceGitPane sessionId="session-1" />);
	await waitFor(() => {
		expect(screen.getByText(NOT_A_REPO_TEXT)).toBeTruthy();
	});
});
