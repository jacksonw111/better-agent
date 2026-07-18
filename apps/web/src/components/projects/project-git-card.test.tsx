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
import { ProjectGitCard } from "./project-git-card";
import type { ProjectGitStatus } from "./project-query";

// Q3: the project detail's Git card — one projects.query git_status on entry
// (branch, dirty, changed files, last commit), a manual refresh, and an
// explanation instead of a query while the project isn't ready or the
// computer is offline.

const SHORT_HASH_PATTERN = /1234567/;
const COMMIT_SUBJECT_PATTERN = /fix: redirect loop/;
const CLONING_PATTERN = /still being cloned/;
const OFFLINE_PATTERN = /offline/;

const store = vi.hoisted(() => ({
	calls: 0,
	git: null as unknown,
}));

vi.mock("./project-query", () => ({
	projectGitStatusOptions: (projectId: string) => ({
		queryKey: ["projects", "query", projectId, "git_status"],
		queryFn: () => {
			store.calls += 1;
			return store.git
				? Promise.resolve(store.git)
				: Promise.reject(new Error("Computer is offline"));
		},
	}),
}));

const CLEAN_GIT: ProjectGitStatus = {
	branch: "main",
	changes: [],
	dirty: false,
	lastCommit: { hash: "abcdef1234567", subject: "feat: initial commit" },
};

const DIRTY_GIT: ProjectGitStatus = {
	branch: "dev",
	changes: [
		{ path: "src/index.ts", status: "M" },
		{ path: "README.md", status: "??" },
	],
	dirty: true,
	lastCommit: { hash: "1234567abcdef", subject: "fix: redirect loop" },
};

function renderCard(overrides: { online?: boolean; status?: string } = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ProjectGitCard
				online={overrides.online ?? true}
				projectId="project-1"
				status={(overrides.status ?? "ready") as "ready"}
			/>
		</QueryClientProvider>
	);
	return { view: within(container) };
}

afterEach(() => {
	store.calls = 0;
	store.git = null;
	cleanup();
});

it("queries git status on entry and renders branch, changes and last commit", async () => {
	store.git = DIRTY_GIT;
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText("dev")).toBeDefined();
	});
	expect(store.calls).toBe(1);
	expect(view.getByText("Dirty")).toBeDefined();
	expect(view.getByText("src/index.ts")).toBeDefined();
	expect(view.getByText("README.md")).toBeDefined();
	expect(view.getByText(SHORT_HASH_PATTERN)).toBeDefined();
	expect(view.getByText(COMMIT_SUBJECT_PATTERN)).toBeDefined();
});

it("shows a clean tree as such", async () => {
	store.git = CLEAN_GIT;
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText("Clean")).toBeDefined();
	});
	expect(view.getByText("No local changes.")).toBeDefined();
});

it("refreshes on demand", async () => {
	const refreshedCallCount = 2;
	store.git = CLEAN_GIT;
	const { view } = renderCard();
	await waitFor(() => {
		expect(view.getByText("main")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: "Refresh Git" }));

	await waitFor(() => {
		expect(store.calls).toBe(refreshedCallCount);
	});
});

it("explains a not-ready project instead of querying", () => {
	const { view } = renderCard({ status: "cloning" });

	expect(view.getByText(CLONING_PATTERN)).toBeDefined();
	expect(store.calls).toBe(0);
	expect(view.queryByRole("button", { name: "Refresh Git" })).toBeNull();
});

it("explains an offline computer instead of querying", () => {
	const { view } = renderCard({ online: false });

	expect(view.getByText(OFFLINE_PATTERN)).toBeDefined();
	expect(store.calls).toBe(0);
});

it("surfaces a failed query with a retry", async () => {
	store.git = null;
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText("Computer is offline")).toBeDefined();
	});
	store.git = CLEAN_GIT;
	fireEvent.click(view.getByRole("button", { name: "Retry" }));
	await waitFor(() => {
		expect(view.getByText("main")).toBeDefined();
	});
});
