// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// DP-WS: the Shell pane runs one command in the session workspace and shows its
// output. We stub the pane shell (its workspace gate is tested server-side) and
// the RPC, then drive the input → output path and the error path.

const store = vi.hoisted(() => ({
	run: vi.fn(),
}));

vi.mock("./workspace-pane-shell", () => ({
	WorkspacePaneShell: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("./workspace-query", () => ({
	runWorkspaceShell: (sessionId: string, cmd: string) =>
		store.run(sessionId, cmd),
}));

const { WorkspaceShellPane } = await import("./workspace-shell-pane");

afterEach(() => {
	cleanup();
	store.run.mockReset();
});

function renderPane() {
	const client = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<WorkspaceShellPane sessionId="session-1" />
		</QueryClientProvider>
	);
}

function runCommand(cmd: string) {
	fireEvent.change(screen.getByLabelText("Shell command"), {
		target: { value: cmd },
	});
	fireEvent.click(screen.getByLabelText("Run command"));
}

it("runs a command and shows its output", async () => {
	store.run.mockResolvedValue({
		exitCode: 0,
		stderr: "",
		stdout: "hello world\n",
		truncated: false,
	});
	const { container } = renderPane();
	runCommand("echo hello world");

	await waitFor(() => {
		expect(container.textContent).toContain("hello world");
	});
	expect(store.run).toHaveBeenCalledWith("session-1", "echo hello world");
	expect(container.textContent).toContain("exit 0");
});

it("shows the error when the command fails to run", async () => {
	store.run.mockRejectedValue(new Error("Computer is not connected"));
	const { container } = renderPane();
	runCommand("ls");

	await waitFor(() => {
		expect(container.textContent).toContain("Computer is not connected");
	});
});
