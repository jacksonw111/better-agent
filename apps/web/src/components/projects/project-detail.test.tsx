// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { makeComputer } from "@/components/tasks/wizard-test-fixtures";
import { ProjectDetail } from "./project-detail";
import { erroredProject, makeProject, readyProject } from "./project-fixtures";

// Q3: the project detail header — name, repo, clone-status chip, and the
// local checkout path (copyable) once ready. The Git/Files/Start-work blocks
// have their own suites; here they're stubbed to their gate props.

const NOT_FOUND_PATTERN = /wasn't found/;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	gates: [] as Record<string, unknown>[],
	project: null as unknown,
}));

vi.mock("./project-git-card", () => ({
	ProjectGitCard: (props: Record<string, unknown>) => {
		store.gates.push({ card: "git", ...props });
		return <div data-testid="git-card" />;
	},
}));

vi.mock("./project-files-card", () => ({
	ProjectFilesCard: (props: Record<string, unknown>) => {
		store.gates.push({ card: "files", ...props });
		return <div data-testid="files-card" />;
	},
}));

vi.mock("./project-start-work", () => ({
	ProjectStartWork: () => <div data-testid="start-work" />,
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
		projects: {
			get: {
				key: () => ["projects", "get"],
				queryOptions: (opts?: { input?: { projectId?: string } }) => ({
					queryKey: ["projects", "get", opts?.input?.projectId],
					queryFn: () =>
						store.project
							? Promise.resolve(store.project)
							: Promise.reject(new Error("Project not found")),
				}),
			},
		},
	},
}));

function renderDetail() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ProjectDetail computerId="computer-1" projectId="project-1" />
		</QueryClientProvider>
	);
	return { view: within(container) };
}

afterEach(() => {
	store.computers = [];
	store.gates.length = 0;
	store.project = null;
	cleanup();
});

it("shows name, repo, status and the copyable local path once ready", async () => {
	store.computers = [makeComputer()];
	store.project = readyProject;
	const { view } = renderDetail();

	await waitFor(() => {
		expect(view.getByText("Better Agent")).toBeDefined();
	});
	expect(view.getByText("acme/better-agent")).toBeDefined();
	expect(view.getByText("Ready")).toBeDefined();
	expect(
		view.getByText("/Users/dev/.better-agent/projects/project1-better-agent")
	).toBeDefined();
	expect(view.getByRole("button", { name: "Copy path" })).toBeDefined();
	expect(view.getByTestId("git-card")).toBeDefined();
	expect(view.getByTestId("files-card")).toBeDefined();
	expect(view.getByTestId("start-work")).toBeDefined();
});

it("hides the local path before the clone finishes and shows the error after a failed one", async () => {
	store.computers = [makeComputer()];
	store.project = erroredProject;
	const { view } = renderDetail();

	await waitFor(() => {
		expect(view.getByText("Private Repo")).toBeDefined();
	});
	expect(view.getByText("Authentication failed for repository")).toBeDefined();
	expect(view.queryByRole("button", { name: "Copy path" })).toBeNull();
});

it("passes the online/status gates down to both cards", async () => {
	store.computers = [makeComputer({ connected: false })];
	store.project = makeProject({ status: "cloning" });
	const { view } = renderDetail();

	await waitFor(() => {
		expect(view.getByTestId("git-card")).toBeDefined();
	});
	await waitFor(() => {
		const git = store.gates.find((gate) => gate.card === "git");
		expect(git?.online).toBe(false);
		expect(git?.status).toBe("cloning");
	});
});

it("shows a not-found state for an unknown project", async () => {
	const { view } = renderDetail();

	await waitFor(() => {
		expect(view.getByText(NOT_FOUND_PATTERN)).toBeDefined();
	});
});
