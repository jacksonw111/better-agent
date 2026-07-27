// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

// DP-WS: the terminal page's tab layout. The load-bearing behavior: switching to
// a side pane must NOT unmount the terminal — the same xterm instance and its
// byte stream stay alive. We prove it by mocking PtyTerminal with a component
// that records every mount and unmount, then asserting a tab switch adds no
// unmount.

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("./pty-terminal", () => ({
	PtyTerminal: () => {
		useEffect(() => {
			lifecycle.mounts += 1;
			return () => {
				lifecycle.unmounts += 1;
			};
		}, []);
		return <div data-testid="pty-terminal" />;
	},
}));

vi.mock("./workspace-files-pane", () => ({
	WorkspaceFilesPane: () => <div data-testid="files-pane" />,
}));
vi.mock("./workspace-git-pane", () => ({
	WorkspaceGitPane: () => <div data-testid="git-pane" />,
}));
vi.mock("./workspace-shell-pane", () => ({
	WorkspaceShellPane: () => <div data-testid="shell-pane" />,
}));

// Imported after the mocks are registered.
const { PtyWorkspaceTabs } = await import("./pty-workspace-tabs");

afterEach(() => {
	cleanup();
	lifecycle.mounts = 0;
	lifecycle.unmounts = 0;
});

function renderTabs() {
	return render(
		<PtyWorkspaceTabs computerId="computer-1" sessionId="session-1" />
	);
}

it("keeps the terminal mounted across tab switches", () => {
	renderTabs();
	expect(lifecycle.mounts).toBe(1);
	expect(lifecycle.unmounts).toBe(0);

	fireEvent.click(screen.getByTestId("workspace-tab-files"));
	fireEvent.click(screen.getByTestId("workspace-tab-git"));
	fireEvent.click(screen.getByTestId("workspace-tab-terminal"));

	// The terminal was never unmounted or remounted — same xterm instance.
	expect(lifecycle.mounts).toBe(1);
	expect(lifecycle.unmounts).toBe(0);
});

it("lazily mounts a pane on first visit and keeps it mounted after", () => {
	renderTabs();
	expect(screen.queryByTestId("files-pane")).toBeNull();

	fireEvent.click(screen.getByTestId("workspace-tab-files"));
	expect(screen.getByTestId("files-pane")).toBeTruthy();

	// Leaving Files keeps it in the tree (hidden), so its state survives.
	fireEvent.click(screen.getByTestId("workspace-tab-git"));
	expect(screen.getByTestId("files-pane")).toBeTruthy();
	expect(screen.getByTestId("git-pane")).toBeTruthy();
});

it("renders each side pane when its tab is opened", () => {
	renderTabs();
	fireEvent.click(screen.getByTestId("workspace-tab-shell"));
	expect(screen.getByTestId("shell-pane")).toBeTruthy();
});
