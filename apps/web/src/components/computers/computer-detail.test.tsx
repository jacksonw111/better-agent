// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { makeComputer } from "@/components/tasks/wizard-test-fixtures";
import { ComputerDetail } from "./computer-detail";

// P3: the /computers/$computerId body — the machine's read-only facts as the
// header, then its AGENT RUNTIME inventory as the main content, each row
// linking into that agent's session list. The task cards and the New Task
// wizard entry left this page.

const META_LINE_PATTERN = /darwin · arm64 · Client 0\.3\.0/;
const NOT_FOUND_PATTERN = /wasn't found/;
const NO_AGENTS_PATTERN = /No agents on this computer/;
const CLAUDE_CODE_PATTERN = /Claude Code/;
const NEW_TASK_PATTERN = /New Task/;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
}));

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
	},
}));

function renderDetail(computerId: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ComputerDetail computerId={computerId} />
		</QueryClientProvider>
	);
	return { view: within(container) };
}

afterEach(() => {
	store.computers = [];
	cleanup();
});

it("shows the computer's facts as the header", async () => {
	store.computers = [makeComputer()];
	const { view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	expect(view.getByText("Connected")).toBeDefined();
	expect(view.getByText(META_LINE_PATTERN)).toBeDefined();
	expect(view.getByText("git installed")).toBeDefined();
	expect(view.getByText("gh missing")).toBeDefined();
});

it("lists the machine's agent runtimes, each linking into its session list", async () => {
	store.computers = [makeComputer()];
	const { view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText("Claude Code")).toBeDefined();
	});
	// The fixture's inventory: claude-code (2 skills) and codex.
	expect(view.getByText("2 skills")).toBeDefined();
	expect(view.getByText("Codex")).toBeDefined();
	const link = view.getByRole("link", { name: CLAUDE_CODE_PATTERN });
	expect(link.getAttribute("href")).toBe(
		"/computers/computer-1/agents/claude-code"
	);
	// The task surface is gone — sessions live one level down, per agent.
	expect(view.queryByText("New Task")).toBeNull();
	expect(view.queryByRole("button", { name: NEW_TASK_PATTERN })).toBeNull();
	expect(view.queryByText("Tasks")).toBeNull();
});

it("explains an empty runtime inventory instead of a blank list", async () => {
	store.computers = [makeComputer({ runtimeInventory: [] })];
	const { view } = renderDetail("computer-1");

	await waitFor(() => {
		expect(view.getByText(NO_AGENTS_PATTERN)).toBeDefined();
	});
});

it("shows a not-found state for an unknown id", async () => {
	store.computers = [makeComputer()];
	const { view } = renderDetail("computer-missing");

	await waitFor(() => {
		expect(view.getByText(NOT_FOUND_PATTERN)).toBeDefined();
	});
	expect(view.queryByText("Studio Mac")).toBeNull();
});
