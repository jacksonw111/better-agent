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
import type { TaskListItem } from "@/utils/api-types";
import { TaskList } from "./task-list";
import { makeComputer } from "./wizard-test-fixtures";

const MS_PER_MINUTE = 60_000;
const NEW_TASK = /New Task/;
const FIX_LOGIN = /Fix login/;
const CREATED_PATTERN = /Created .*minute ago/;
const STUDIO_MAC = /Studio Mac/;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	tasks: [] as unknown[],
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
			href={params ? to.replace("$taskId", params.taskId ?? "") : to}
		>
			{children}
		</a>
	),
	useNavigate: () => () => undefined,
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
					mutationFn: () =>
						Promise.resolve({ runId: "run-1", taskId: "task-1" }),
					...opts,
				}),
			},
			list: {
				key: () => ["tasks", "list"],
				queryOptions: () => ({
					queryKey: ["tasks", "list"],
					queryFn: () => Promise.resolve(store.tasks),
				}),
			},
		},
	},
}));

function makeTask(overrides: Partial<TaskListItem> = {}): TaskListItem {
	return {
		id: "task-1",
		name: "Fix login",
		agentKind: "claude-code",
		computerId: "computer-1",
		createdAt: new Date(Date.now() - MS_PER_MINUTE),
		status: "active",
		latestRun: {
			createdAt: new Date(Date.now() - MS_PER_MINUTE),
			errorMessage: null,
			hasAgentSessionId: false,
			id: "run-1",
			status: "running",
		},
		...overrides,
	};
}

function renderList() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	// The New Task modal renders through a portal, so queries scope to body.
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<TaskList />
		</QueryClientProvider>
	);
	return within(container.ownerDocument.body);
}

afterEach(() => {
	store.computers = [];
	store.tasks = [];
	cleanup();
});

it("shows an empty state whose New Task button opens the wizard modal", async () => {
	const view = renderList();

	await waitFor(() => {
		expect(view.getByText("No tasks yet")).toBeDefined();
	});
	// No modal until asked for.
	expect(view.queryByRole("dialog")).toBeNull();

	fireEvent.click(view.getByRole("button", { name: NEW_TASK }));

	expect(await view.findByRole("dialog")).toBeDefined();
	expect(view.getByText("New task")).toBeDefined();
	// No computers paired: the wizard's own empty state shows inside the modal.
	expect(await view.findByText("No computers to run on")).toBeDefined();
});

it("renders a task with computer name, runtime, status chip and relative time", async () => {
	store.tasks = [makeTask()];
	store.computers = [makeComputer()];
	const view = renderList();

	await waitFor(() => {
		expect(view.getByText("Fix login")).toBeDefined();
	});
	expect(view.getByText("Studio Mac · Claude Code")).toBeDefined();
	expect(view.getByText("Running")).toBeDefined();
	expect(view.getByText(CREATED_PATTERN)).toBeDefined();
	// The whole card is a link into the task conversation.
	const link = view.getByRole("link", { name: FIX_LOGIN });
	expect(link.getAttribute("href")).toBe("/tasks/task-1");
	// And the top toolbar offers New Task.
	expect(view.getByRole("button", { name: NEW_TASK })).toBeDefined();
});

it("opens the New Task wizard modal at Step 1 from the toolbar", async () => {
	store.tasks = [makeTask()];
	store.computers = [makeComputer()];
	const view = renderList();

	await waitFor(() => {
		expect(view.getByText("Fix login")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: NEW_TASK }));

	expect(await view.findByRole("dialog")).toBeDefined();
	// Step 1 (Runtime) is live: the paired computer is offered for selection.
	expect(await view.findByRole("radio", { name: STUDIO_MAC })).toBeDefined();
	const runtimeStep = view.getByText("Runtime").closest("li");
	expect(runtimeStep?.getAttribute("aria-current")).toBe("step");
});

it("maps run statuses onto the chip semantics", async () => {
	store.tasks = [
		makeTask(),
		makeTask({
			id: "task-2",
			name: "Broken one",
			latestRun: {
				createdAt: new Date(),
				errorMessage: "git clone failed",
				hasAgentSessionId: false,
				id: "run-2",
				status: "failed",
			},
		}),
		makeTask({ id: "task-3", name: "Fresh one", latestRun: null }),
	];
	const view = renderList();

	await waitFor(() => {
		expect(view.getByText("Running")).toBeDefined();
	});
	expect(view.getByText("Failed")).toBeDefined();
	expect(view.getByText("No runs")).toBeDefined();
});

it("falls back gracefully when the computer is gone", async () => {
	store.tasks = [makeTask()];
	const view = renderList();

	await waitFor(() => {
		expect(view.getByText("Fix login")).toBeDefined();
	});
	expect(view.getByText("Unknown computer · Claude Code")).toBeDefined();
});
