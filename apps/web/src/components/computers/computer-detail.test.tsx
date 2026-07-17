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
import { makeComputer } from "@/components/tasks/wizard-test-fixtures";
import type { TaskListItem } from "@/utils/api-types";
import { ComputerDetail } from "./computer-detail";

// The /computers/$computerId body: the machine's read-only facts, THIS
// computer's tasks (same card shape as /tasks, filtered client-side), and a
// New Task button that opens the wizard with this computer pre-selected.

const MS_PER_MINUTE = 60_000;
const META_LINE_PATTERN = /darwin · arm64 · Client 0\.3\.0/;
const STUDIO_MAC = /Studio Mac/;
const NOT_FOUND_PATTERN = /wasn't found/;
const CREATED_PATTERN = /Created .*minute ago/;
const FIX_LOGIN = /Fix login/;
const NEW_TASK = /New Task/;

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

function renderDetail(computerId: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ComputerDetail computerId={computerId} />
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		view: within(container),
	};
}

afterEach(() => {
	store.computers = [];
	store.tasks = [];
	cleanup();
});

it("shows the computer's facts without an installed-agents section", async () => {
	store.computers = [makeComputer()];
	const { view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	expect(view.getByText("Connected")).toBeDefined();
	expect(view.getByText(META_LINE_PATTERN)).toBeDefined();
	expect(view.getByText("git installed")).toBeDefined();
	expect(view.getByText("gh missing")).toBeDefined();
	// Agent inventory left this page — runtime choice lives in the New Task
	// wizard only.
	expect(view.queryByText("Installed agents")).toBeNull();
	expect(view.queryByText("2 skills")).toBeNull();
	expect(view.queryByText("Skills not discoverable")).toBeNull();
});

it("lists only this computer's tasks, in the /tasks card shape", async () => {
	store.computers = [makeComputer()];
	store.tasks = [
		makeTask(),
		makeTask({ computerId: "computer-2", id: "task-9", name: "Elsewhere" }),
	];
	const { view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Fix login")).toBeDefined();
	});
	// Name, runtime, latest-run status chip, relative time — each card links
	// into the task conversation.
	expect(view.getByText("Claude Code")).toBeDefined();
	expect(view.getByText("Running")).toBeDefined();
	expect(view.getByText(CREATED_PATTERN)).toBeDefined();
	const link = view.getByRole("link", { name: FIX_LOGIN });
	expect(link.getAttribute("href")).toBe("/tasks/task-1");
	// Tasks bound to another computer stay off this page.
	expect(view.queryByText("Elsewhere")).toBeNull();
});

it("shows an empty state whose New Task action opens the wizard pre-selected", async () => {
	store.computers = [makeComputer()];
	const { body, view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("No tasks on this computer yet")).toBeDefined();
	});
	// The empty state guides to New Task; it opens the same pre-selected wizard.
	const buttons = view.getAllByRole("button", { name: NEW_TASK });
	fireEvent.click(buttons.at(-1) as HTMLElement);

	const radio = (await body.findByRole("radio", {
		name: STUDIO_MAC,
	})) as HTMLInputElement;
	expect(radio.checked).toBe(true);
});

it("shows a not-found state for an unknown id", async () => {
	store.computers = [makeComputer()];
	const { view } = renderDetail("computer-missing");

	await waitFor(() => {
		expect(view.getByText(NOT_FOUND_PATTERN)).toBeDefined();
	});
	expect(view.queryByText("Studio Mac")).toBeNull();
});

it("opens New Task with this computer pre-selected from the header", async () => {
	store.computers = [makeComputer()];
	const { body, view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	fireEvent.click(view.getAllByRole("button", { name: NEW_TASK })[0]);

	const radio = (await body.findByRole("radio", {
		name: STUDIO_MAC,
	})) as HTMLInputElement;
	expect(radio.checked).toBe(true);

	// Pre-selection alone is not content — the untouched wizard closes silently.
	fireEvent.click(body.getByRole("button", { name: "Close" }));
	expect(body.queryByText("Discard this task?")).toBeNull();
	await waitFor(() => {
		expect(body.queryByRole("radio", { name: STUDIO_MAC })).toBeNull();
	});
});
