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
import { AgentSessionList, parseAgentKind } from "./agent-session-list";

// P3: one agent's sessions on one computer. tasks.list is narrowed
// server-side ({computerId, agentKind}); New session creates a task directly
// (empty description, no wizard) and lands in the chat.

const MS_PER_MINUTE = 60_000;
const NEW_SESSION = /New session/;
const MINUTE_AGO_PATTERN = /1 minute ago/;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	createCalls: [] as unknown[],
	createError: null as string | null,
	listInputs: [] as unknown[],
	navigations: [] as unknown[],
	sessions: [] as unknown[],
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		params,
		to,
	}: {
		children?: React.ReactNode;
		className?: string;
		params?: Record<string, string>;
		to: string;
	}) => (
		<a
			className={className}
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to
			)}
		>
			{children}
		</a>
	),
	useNavigate: () => (options: { params?: Record<string, string> }) => {
		store.navigations.push(options.params?.taskId);
		return Promise.resolve();
	},
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		computers: {
			list: {
				key: () => ["computers", "list"],
				queryOptions: () => ({
					queryKey: ["computers", "list"],
					queryFn: () => Promise.resolve(store.computers),
				}),
			},
		},
		tasks: {
			create: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (input: unknown) => {
						store.createCalls.push(input);
						return store.createError
							? Promise.reject(new Error(store.createError))
							: Promise.resolve({ runId: "run-1", taskId: "task-new" });
					},
					...opts,
				}),
			},
			list: {
				key: () => ["tasks", "list"],
				queryOptions: (opts?: { input?: unknown }) => ({
					queryKey: ["tasks", "list", opts?.input],
					queryFn: () => {
						store.listInputs.push(opts?.input);
						return Promise.resolve(store.sessions);
					},
				}),
			},
		},
	},
}));

function makeSession(overrides: Record<string, unknown> = {}) {
	return {
		agentKind: "claude-code",
		computerId: "computer-1",
		createdAt: new Date(Date.now() - MS_PER_MINUTE),
		id: "task-1",
		latestRun: {
			createdAt: new Date(Date.now() - MS_PER_MINUTE),
			errorMessage: null,
			hasAgentSessionId: true,
			id: "run-1",
			status: "running",
		},
		name: "Session 7/17 14:05",
		status: "active",
		...overrides,
	};
}

function renderList() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<AgentSessionList agentKind="claude-code" computerId="computer-1" />
		</QueryClientProvider>
	);
	return { view: within(container) };
}

afterEach(() => {
	store.computers = [];
	store.createCalls.length = 0;
	store.createError = null;
	store.listInputs.length = 0;
	store.navigations.length = 0;
	store.sessions = [];
	cleanup();
});

it("narrows tasks.list to this computer + agent and lists sessions newest first", async () => {
	store.sessions = [
		makeSession(),
		makeSession({
			createdAt: new Date(),
			id: "task-2",
			latestRun: null,
			name: "Newest session",
		}),
	];
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("Session 7/17 14:05")).toBeDefined();
	});
	// Server-side narrowing: the filter rides the query input.
	expect(store.listInputs[0]).toEqual({
		agentKind: "claude-code",
		computerId: "computer-1",
	});
	// Name, latest-run status chip, relative age; each row links to the chat.
	expect(view.getByText("Running")).toBeDefined();
	expect(view.getByText("No runs")).toBeDefined();
	expect(view.getByText(MINUTE_AGO_PATTERN)).toBeDefined();
	const links = view.getAllByRole("link");
	const rowLinks = links.filter((link) =>
		link.getAttribute("href")?.startsWith("/tasks/")
	);
	// Newest first: task-2 (just created) above task-1 (a minute old).
	expect(rowLinks.map((link) => link.getAttribute("href"))).toEqual([
		"/tasks/task-2",
		"/tasks/task-1",
	]);
});

it("starts a session directly — empty description, no wizard — and lands in the chat", async () => {
	store.sessions = [makeSession()];
	const { view } = renderList();

	const button = await waitFor(() =>
		view.getByRole("button", { name: NEW_SESSION })
	);
	fireEvent.click(button);

	await waitFor(() => {
		expect(store.createCalls).toEqual([
			{ agentKind: "claude-code", computerId: "computer-1", description: "" },
		]);
	});
	await waitFor(() => {
		expect(store.navigations).toEqual(["task-new"]);
	});
	// No wizard dialog ever opens.
	expect(view.queryByText("Discard this task?")).toBeNull();
	expect(view.queryByRole("dialog")).toBeNull();
});

it("guides an empty list toward New session", async () => {
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("No sessions yet")).toBeDefined();
	});
	// Header + empty state both offer it.
	const buttons = view.getAllByRole("button", { name: NEW_SESSION });
	expect(buttons.length).toBeGreaterThan(1);
	fireEvent.click(buttons.at(-1) as HTMLElement);
	await waitFor(() => {
		expect(store.navigations).toEqual(["task-new"]);
	});
});

it("stays on the list when create fails (offline computer)", async () => {
	store.createError = "Computer is offline";
	const { view } = renderList();

	const button = await waitFor(() =>
		view.getByRole("button", { name: NEW_SESSION })
	);
	fireEvent.click(button);

	await waitFor(() => {
		expect(store.createCalls.length).toBe(1);
	});
	expect(store.navigations).toEqual([]);
});

it("parseAgentKind narrows path params to real agent kinds", () => {
	expect(parseAgentKind("claude-code")).toBe("claude-code");
	expect(parseAgentKind("pi")).toBe("pi");
	expect(parseAgentKind("not-an-agent")).toBeNull();
});
