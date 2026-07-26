// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PtyTerminalScreen } from "./pty-terminal-screen";

const END_SESSION = /End session/;

// P25-B: the terminal page body — titles the session from the live list and
// offers End session; leaving (Back) is a detach that does NOT end it.

const store = vi.hoisted(() => ({
	endInput: null as Record<string, unknown> | null,
	navigations: [] as Record<string, unknown>[],
	sessions: [] as unknown[],
	terminalProps: null as Record<string, unknown> | null,
}));

vi.mock("sonner", () => ({
	toast: { error: () => undefined, success: () => undefined },
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
	}: {
		children?: React.ReactNode;
		params?: Record<string, string>;
		to: string;
	}) => (
		<a
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to
			)}
		>
			{children}
		</a>
	),
	useNavigate: () => (arg: Record<string, unknown>) => {
		store.navigations.push(arg);
		return Promise.resolve();
	},
}));

vi.mock("./pty-terminal", () => ({
	PtyTerminal: (props: Record<string, unknown>) => {
		store.terminalProps = props;
		return <div data-testid="pty-terminal" />;
	},
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		pty: {
			endSession: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (input: Record<string, unknown>) => {
						store.endInput = input;
						return Promise.resolve({ ok: true });
					},
					...opts,
				}),
			},
			listSessions: {
				queryOptions: (opts?: { input?: unknown }) => ({
					queryKey: ["pty", "listSessions", opts?.input],
					queryFn: () => Promise.resolve({ sessions: store.sessions }),
				}),
			},
		},
	},
}));

function renderScreen(spec?: unknown) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<PtyTerminalScreen
				computerId="computer-1"
				sessionId="session-1"
				spec={spec as never}
			/>
		</QueryClientProvider>
	);
	return { body: within(document.body), view: within(container) };
}

afterEach(() => {
	store.endInput = null;
	store.navigations.length = 0;
	store.sessions = [];
	store.terminalProps = null;
	cleanup();
});

it("titles the terminal from the live session and reattaches the id", async () => {
	store.sessions = [
		{
			agentKind: "claude-code",
			lastActivityAt: new Date(),
			projectId: null,
			sessionId: "session-1",
			status: "active",
			title: "Session 7/26 14:05",
		},
	];
	const { view } = renderScreen();

	await waitFor(() => {
		expect(view.getByText("Session 7/26 14:05")).toBeDefined();
	});
	// The terminal attaches to the same id (no spec on a reattach).
	expect(store.terminalProps).toMatchObject({
		computerId: "computer-1",
		sessionId: "session-1",
	});
});

it("ends the session after confirm and returns to the computer", async () => {
	store.sessions = [
		{
			agentKind: "claude-code",
			lastActivityAt: new Date(),
			projectId: null,
			sessionId: "session-1",
			status: "active",
			title: "Session 7/26 14:05",
		},
	];
	const { body, view } = renderScreen();

	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: END_SESSION }))
	);
	fireEvent.click(await body.findByRole("button", { name: "End" }));

	await waitFor(() => {
		expect(store.endInput).toEqual({ sessionId: "session-1" });
	});
	await waitFor(() => {
		expect(store.navigations).toEqual([
			{ params: { computerId: "computer-1" }, to: "/computers/$computerId" },
		]);
	});
});

it("returns to the project when the ended session belongs to one", async () => {
	store.sessions = [
		{
			agentKind: "claude-code",
			lastActivityAt: new Date(),
			projectId: "proj-1",
			sessionId: "session-1",
			status: "active",
			title: "Session 7/26 14:05",
		},
	];
	const { body, view } = renderScreen();

	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: END_SESSION }))
	);
	fireEvent.click(await body.findByRole("button", { name: "End" }));

	await waitFor(() => {
		expect(store.navigations).toEqual([
			{
				params: { computerId: "computer-1", projectId: "proj-1" },
				to: "/computers/$computerId/projects/$projectId",
			},
		]);
	});
});
