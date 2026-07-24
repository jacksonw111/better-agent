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
import { erroredProject, makeProject, readyProject } from "./project-fixtures";
import {
	ComputerProjectList,
	PROJECT_POLL_INTERVAL_MS,
	projectsPollInterval,
} from "./project-list";

// Q3: the Computer detail page's Projects block — one row per project (name,
// repo, clone-status chip, error message), each linking into the project
// detail page, plus a per-row Delete (popover confirm) that removes the
// server-side record only. The list polls every 5s ONLY while a clone is
// still pending.

const PROJECT_NAME_PATTERN = /Better Agent/;
const CHECKOUT_KEPT_PATTERN = /local checkout directory .* is not deleted/;

const store = vi.hoisted(() => ({
	deleteArgs: [] as Record<string, unknown>[],
	deleteError: null as Error | null,
	projects: [] as unknown[],
	toastErrors: [] as string[],
}));

vi.mock("sonner", () => ({
	toast: {
		error: (message: string) => {
			store.toastErrors.push(message);
		},
	},
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		"aria-label": ariaLabel,
		children,
		className,
		params,
		to,
	}: {
		"aria-label"?: string;
		children?: React.ReactNode;
		className?: string;
		params?: Record<string, string>;
		to: string;
	}) => (
		<a
			aria-label={ariaLabel}
			className={className}
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to
			)}
		>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		pty: {
			createSession: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: () =>
						Promise.resolve({
							args: [],
							command: "claude",
							computerId: "computer-1",
							cwd: "/work",
							sessionId: "session-1",
						}),
					...opts,
				}),
			},
		},
		projects: {
			delete: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.deleteArgs.push(args);
						return store.deleteError
							? Promise.reject(store.deleteError)
							: Promise.resolve({ ok: true });
					},
					...opts,
				}),
			},
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
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ComputerProjectList computerId="computer-1" />
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		view: within(container),
	};
}

afterEach(() => {
	store.deleteArgs.length = 0;
	store.deleteError = null;
	store.projects = [];
	store.toastErrors.length = 0;
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

it("deletes a row only after the confirm that explains the checkout is kept", async () => {
	store.projects = [readyProject];
	const { body, view } = renderList();

	await waitFor(() => {
		expect(view.getByText(PROJECT_NAME_PATTERN)).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "Delete" }));
	// The confirm copy says the local checkout directory is NOT deleted.
	expect(body.getByText(CHECKOUT_KEPT_PATTERN)).toBeDefined();
	expect(store.deleteArgs).toEqual([]);

	fireEvent.click(body.getByRole("button", { name: "Confirm" }));
	await waitFor(() => {
		expect(store.deleteArgs).toEqual([{ projectId: "project-1" }]);
	});
});

it("surfaces a row delete failure as an error toast", async () => {
	store.projects = [readyProject];
	store.deleteError = new Error("Project not found");
	const { body, view } = renderList();

	await waitFor(() => {
		expect(view.getByText(PROJECT_NAME_PATTERN)).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	await waitFor(() => {
		expect(store.toastErrors).toEqual(["Project not found"]);
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
