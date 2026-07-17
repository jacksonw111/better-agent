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
import { ComputerDetail } from "./computer-detail";

// The /computers/$computerId body: the machine's read-only facts, its
// installed agent runtimes (with skill counts for discoverable ones), and a
// New Task button that opens the wizard with THIS computer pre-selected.

const META_LINE_PATTERN = /darwin · arm64 · Client 0\.3\.0/;
const STUDIO_MAC = /Studio Mac/;
const NOT_FOUND_PATTERN = /wasn't found/;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		to,
	}: {
		children?: React.ReactNode;
		className?: string;
		to: string;
	}) => (
		<a className={className} href={to}>
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
		},
	},
}));

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
	cleanup();
});

it("shows the computer's facts and its installed agents", async () => {
	store.computers = [makeComputer()];
	const { view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	expect(view.getByText("Connected")).toBeDefined();
	expect(view.getByText(META_LINE_PATTERN)).toBeDefined();
	expect(view.getByText("git installed")).toBeDefined();
	expect(view.getByText("gh missing")).toBeDefined();
	// One row per detected runtime: discoverable ones carry a skill count,
	// capability-"none" ones say so instead of pretending.
	expect(view.getByText("Claude Code")).toBeDefined();
	expect(view.getByText("2 skills")).toBeDefined();
	expect(view.getByText("Codex")).toBeDefined();
	expect(view.getByText("Skills not discoverable")).toBeDefined();
});

it("says so when no supported runtimes were detected", async () => {
	store.computers = [makeComputer({ runtimeInventory: [] })];
	const { view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	expect(
		view.getByText("No supported runtimes detected on this computer.")
	).toBeDefined();
});

it("shows a not-found state for an unknown id", async () => {
	store.computers = [makeComputer()];
	const { view } = renderDetail("computer-missing");

	await waitFor(() => {
		expect(view.getByText(NOT_FOUND_PATTERN)).toBeDefined();
	});
	expect(view.queryByText("Studio Mac")).toBeNull();
});

it("opens New Task with this computer pre-selected", async () => {
	store.computers = [makeComputer()];
	const { body, view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "New Task" }));

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
