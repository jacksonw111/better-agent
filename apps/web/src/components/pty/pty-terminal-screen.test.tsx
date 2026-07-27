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
	getSessionInput: null as Record<string, unknown> | null,
	navigations: [] as Record<string, unknown>[],
	sessions: [] as unknown[],
	spec: null as Record<string, unknown> | null,
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
			getSession: {
				queryOptions: (opts?: { input?: Record<string, unknown> }) => ({
					queryKey: ["pty", "getSession", opts?.input],
					queryFn: () => {
						store.getSessionInput = opts?.input ?? null;
						return Promise.resolve(store.spec);
					},
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

function renderScreen(fallbackSpec?: unknown) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<PtyTerminalScreen
				computerId="computer-1"
				fallbackSpec={fallbackSpec as never}
				sessionId="session-1"
			/>
		</QueryClientProvider>
	);
	return { body: within(document.body), view: within(container) };
}

afterEach(() => {
	store.endInput = null;
	store.getSessionInput = null;
	store.navigations.length = 0;
	store.sessions = [];
	store.spec = null;
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
	await waitFor(() => {
		expect(store.terminalProps).toMatchObject({
			computerId: "computer-1",
			sessionId: "session-1",
		});
	});
});

it("reattach sends the fetched spawn spec (not null) so a dead pty resumes", async () => {
	// A bare reattach: no fallbackSpec, but getSession returns the bound spec.
	store.spec = {
		agentKind: "claude-code",
		agentSessionId: "session-1",
		agentSessionStarted: true,
		args: [],
		command: "claude",
		cwd: "/repo",
	};

	renderScreen();

	await waitFor(() => {
		expect(store.terminalProps).not.toBeNull();
	});
	// getSession was fetched for this session, and its spec (with the resumable
	// binding) rode down to the terminal instead of spec:null.
	expect(store.getSessionInput).toEqual({ sessionId: "session-1" });
	expect(store.terminalProps?.spec).toMatchObject({
		agentKind: "claude-code",
		agentSessionId: "session-1",
		agentSessionStarted: true,
		command: "claude",
		cwd: "/repo",
	});
});

it("falls back to the URL spec when getSession yields nothing", async () => {
	store.spec = null; // getSession produced no spec
	renderScreen({ args: [], command: "codex", cwd: "/fallback" });

	await waitFor(() => {
		expect(store.terminalProps).not.toBeNull();
	});
	expect(store.terminalProps?.spec).toMatchObject({
		command: "codex",
		cwd: "/fallback",
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
