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
import { PtySessionList } from "./pty-session-list";

// P25-B: the one-click PTY entry. listSessions is the source of truth; a whole
// row reattaches (navigates to /terminal/$computerId?session=<id>), New session
// mints one and opens it, End stops one and drops it from the list.

const MS_PER_MINUTE = 60_000;
const NEW_SESSION = /New session/;
const END_SESSION = /End session/;

const store = vi.hoisted(() => ({
	createInput: null as Record<string, unknown> | null,
	endInput: null as Record<string, unknown> | null,
	listInputs: [] as unknown[],
	navigations: [] as Record<string, unknown>[],
	sessions: [] as unknown[],
}));

vi.mock("sonner", () => ({
	toast: { error: () => undefined, success: () => undefined },
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => (arg: Record<string, unknown>) => {
		store.navigations.push(arg);
		return Promise.resolve();
	},
}));

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
							sessionId: "session-new",
						});
					},
					...opts,
				}),
			},
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
				key: () => ["pty", "listSessions"],
				queryOptions: (opts?: { input?: unknown }) => ({
					queryKey: ["pty", "listSessions", opts?.input],
					queryFn: () => {
						store.listInputs.push(opts?.input);
						return Promise.resolve({ sessions: store.sessions });
					},
				}),
			},
		},
	},
}));

function makeSession(overrides: Record<string, unknown> = {}) {
	return {
		agentKind: "claude-code",
		createdAt: new Date(Date.now() - MS_PER_MINUTE),
		lastActivityAt: new Date(Date.now() - MS_PER_MINUTE),
		projectId: null,
		sessionId: "session-1",
		status: "active",
		title: "Session 7/26 14:05",
		...overrides,
	};
}

function renderList(props?: Partial<Parameters<typeof PtySessionList>[0]>) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<PtySessionList
				computerId="computer-1"
				runtimes={["claude-code"]}
				{...props}
			/>
		</QueryClientProvider>
	);
	// Popover confirm content portals to document.body.
	return { body: within(document.body), view: within(container) };
}

afterEach(() => {
	store.createInput = null;
	store.endInput = null;
	store.listInputs.length = 0;
	store.navigations.length = 0;
	store.sessions = [];
	cleanup();
});

it("lists live sessions and reattaches a whole-row click with the session id", async () => {
	store.sessions = [
		makeSession(),
		makeSession({ sessionId: "session-2", title: "Session 7/26 15:30" }),
	];
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("Session 7/26 14:05")).toBeDefined();
	});
	// The list is scoped to the computer (no project here).
	expect(store.listInputs[0]).toEqual({
		computerId: "computer-1",
		projectId: undefined,
	});

	fireEvent.click(view.getByText("Session 7/26 15:30"));
	await waitFor(() => {
		expect(store.navigations).toEqual([
			{
				params: { computerId: "computer-1" },
				search: { session: "session-2" },
				to: "/terminal/$computerId",
			},
		]);
	});
});

it("scopes the list and New session to a project when given a projectId", async () => {
	store.sessions = [makeSession({ projectId: "proj-1" })];
	const { view } = renderList({ projectId: "proj-1" });

	await waitFor(() => {
		expect(store.listInputs[0]).toEqual({
			computerId: "computer-1",
			projectId: "proj-1",
		});
	});

	fireEvent.click(view.getAllByRole("button", { name: NEW_SESSION })[0]);
	await waitFor(() => {
		expect(store.createInput).toEqual({
			agentKind: "claude-code",
			computerId: "computer-1",
			projectId: "proj-1",
		});
	});
});

it("opens a fresh terminal in one step on New session", async () => {
	store.sessions = [makeSession()];
	const { view } = renderList();

	fireEvent.click(
		await waitFor(() => view.getAllByRole("button", { name: NEW_SESSION })[0])
	);

	await waitFor(() => {
		expect(store.createInput).toEqual({
			agentKind: "claude-code",
			computerId: "computer-1",
			projectId: undefined,
		});
	});
	await waitFor(() => {
		expect(store.navigations).toEqual([
			{
				params: { computerId: "computer-1" },
				search: { cmd: "claude", cwd: "/work/proj", session: "session-new" },
				to: "/terminal/$computerId",
			},
		]);
	});
});

it("ends a session after confirm and calls endSession with its id", async () => {
	store.sessions = [makeSession()];
	const { body, view } = renderList();

	const endTrigger = await waitFor(() =>
		view.getByRole("button", { name: END_SESSION })
	);
	fireEvent.click(endTrigger);
	// Confirm inside the portaled popover — the destructive "End" action.
	fireEvent.click(await body.findByRole("button", { name: "End" }));

	await waitFor(() => {
		expect(store.endInput).toEqual({ sessionId: "session-1" });
	});
});

it("guides an empty list toward New session", async () => {
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("No terminal sessions yet")).toBeDefined();
	});
	const buttons = view.getAllByRole("button", { name: NEW_SESSION });
	// Header + empty-state both offer it.
	expect(buttons.length).toBeGreaterThan(1);
});
