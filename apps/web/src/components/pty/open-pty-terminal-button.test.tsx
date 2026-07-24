// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OpenPtyTerminalButton } from "./open-pty-terminal-button";

// P2-3a: the "Open terminal (beta)" entry. Clicking it mints a session via
// pty.createSession, then navigates to /terminal/$computerId carrying the
// sessionId + resolved spawn spec — no hand-crafted ?pty= URL.

const store = vi.hoisted(() => ({
	createInput: null as Record<string, unknown> | null,
	navigateArg: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => (arg: Record<string, unknown>) => {
		store.navigateArg = arg;
	},
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		pty: {
			createSession: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (input: Record<string, unknown>) => {
						store.createInput = input;
						return Promise.resolve({
							args: [],
							command: "claude",
							computerId: "computer-1",
							cwd: "/work/proj",
							sessionId: "session-9",
						});
					},
					...opts,
				}),
			},
		},
	},
}));

function renderButton() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<OpenPtyTerminalButton
				agentKind="claude-code"
				computerId="computer-1"
				projectId="proj-1"
			/>
		</QueryClientProvider>
	);
}

afterEach(() => {
	store.createInput = null;
	store.navigateArg = null;
	cleanup();
});

it("creates a session with the computer/agent/project then navigates with the spec", async () => {
	const { getByRole } = renderButton();
	fireEvent.click(getByRole("button"));

	await waitFor(() => {
		expect(store.navigateArg).not.toBeNull();
	});
	expect(store.createInput).toEqual({
		agentKind: "claude-code",
		computerId: "computer-1",
		projectId: "proj-1",
	});
	expect(store.navigateArg).toEqual({
		params: { computerId: "computer-1" },
		search: { cmd: "claude", cwd: "/work/proj", session: "session-9" },
		to: "/terminal/$computerId",
	});
});
