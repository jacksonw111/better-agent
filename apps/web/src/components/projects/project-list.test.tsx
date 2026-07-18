// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { erroredProject, makeProject, readyProject } from "./project-fixtures";
import {
	ComputerProjectList,
	PROJECT_POLL_INTERVAL_MS,
	projectsPollInterval,
} from "./project-list";

// Q3: the Computer detail page's Projects block — one row per project (name,
// repo, clone-status chip, error message), each linking into the project
// detail page. The list polls every 5s ONLY while a clone is still pending.

const PROJECT_NAME_PATTERN = /Better Agent/;

const store = vi.hoisted(() => ({
	projects: [] as unknown[],
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
		projects: {
			list: {
				key: () => ["projects", "list"],
				queryOptions: (opts?: { input?: unknown }) => ({
					queryKey: ["projects", "list", opts?.input],
					queryFn: () => Promise.resolve(store.projects),
				}),
			},
		},
	},
}));

function renderList() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ComputerProjectList computerId="computer-1" />
		</QueryClientProvider>
	);
	return { view: within(container) };
}

afterEach(() => {
	store.projects = [];
	cleanup();
});

it("renders each project with name, repo and a status chip", async () => {
	store.projects = [
		makeProject({ id: "project-created", name: "Created One" }),
		makeProject({ id: "project-2", name: "Cloning One", status: "cloning" }),
		readyProject,
		erroredProject,
	];
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("Better Agent")).toBeDefined();
	});
	expect(view.getByText("Created One")).toBeDefined();
	expect(view.getAllByText("acme/better-agent").length).toBeGreaterThan(0);
	// One chip per clone state: created queues, cloning spins, ready, error.
	expect(view.getByText("Queued")).toBeDefined();
	expect(view.getByText("Cloning")).toBeDefined();
	expect(view.getByText("Ready")).toBeDefined();
	expect(view.getByText("Error")).toBeDefined();
	// The error row carries the REAL clone failure.
	expect(view.getByText("Authentication failed for repository")).toBeDefined();
});

it("links each row into the project detail page", async () => {
	store.projects = [readyProject];
	const { view } = renderList();

	const link = await waitFor(() =>
		view.getByRole("link", { name: PROJECT_NAME_PATTERN })
	);
	expect(link.getAttribute("href")).toBe(
		"/computers/computer-1/projects/project-1"
	);
});

it("explains an empty project list instead of a blank", async () => {
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("No projects yet")).toBeDefined();
	});
});

it("polls only while a clone is still pending", () => {
	expect(projectsPollInterval(undefined)).toBe(false);
	expect(projectsPollInterval([])).toBe(false);
	expect(projectsPollInterval([readyProject, erroredProject])).toBe(false);
	expect(projectsPollInterval([readyProject, makeProject()])).toBe(
		PROJECT_POLL_INTERVAL_MS
	);
	expect(projectsPollInterval([makeProject({ status: "cloning" })])).toBe(
		PROJECT_POLL_INTERVAL_MS
	);
});
