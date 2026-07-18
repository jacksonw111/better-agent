// @vitest-environment jsdom

import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { describeChangeStatus, ProjectGitCard } from "./project-git-card";
import type { ProjectGitStatus } from "./project-query";

// Q3: the project detail's Git card — one projects.query git_status on entry
// (branch, dirty, changed files, last commit), a manual refresh, and an
// explanation instead of a query while the project isn't ready or the
// computer is offline. Q3 wrap-up: porcelain XY statuses render as friendly
// labels, a null branch reads "detached HEAD", and the Q2 error codes each
// get their own treatment (PRECONDITION_FAILED notice, TIMEOUT retry).

const SHORT_HASH_PATTERN = /1234567/;
const COMMIT_SUBJECT_PATTERN = /fix: redirect loop/;
const CLONING_PATTERN = /still being cloned/;
const OFFLINE_PATTERN = /offline/;
const RECONNECT_PATTERN = /reconnect it and retry/;
const TIMEOUT_PATTERN = /did not answer in time/;

const store = vi.hoisted(() => ({
	calls: 0,
	error: null as unknown,
	git: null as unknown,
}));

vi.mock("./project-query", () => ({
	projectGitStatusOptions: (projectId: string) => ({
		queryKey: ["projects", "query", projectId, "git_status"],
		queryFn: () => {
			store.calls += 1;
			return store.git
				? Promise.resolve(store.git)
				: Promise.reject(store.error ?? new Error("Computer is offline"));
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
		{ path: "src/index.ts", status: " M" },
		{ path: "README.md", status: "??" },
		{ path: "src/new-file.ts", status: "A " },
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
	store.error = null;
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
	// Raw porcelain pairs render as friendly labels, not " M"/"??"/"A ".
	expect(view.getByText("modified")).toBeDefined();
	expect(view.getByText("untracked")).toBeDefined();
	expect(view.getByText("added")).toBeDefined();
});

it("shows a null branch as a detached HEAD", async () => {
	store.git = { ...CLEAN_GIT, branch: null };
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText("detached HEAD")).toBeDefined();
	});
});

it("maps porcelain XY pairs to friendly labels, unknown codes verbatim", () => {
	expect(describeChangeStatus("??")).toEqual({
		kind: "untracked",
		label: "untracked",
	});
	expect(describeChangeStatus("A ")).toEqual({ kind: "added", label: "added" });
	expect(describeChangeStatus("AM")).toEqual({ kind: "added", label: "added" });
	expect(describeChangeStatus(" M")).toEqual({
		kind: "modified",
		label: "modified",
	});
	expect(describeChangeStatus("MM")).toEqual({
		kind: "modified",
		label: "modified",
	});
	expect(describeChangeStatus(" T")).toEqual({
		kind: "modified",
		label: "modified",
	});
	expect(describeChangeStatus("D ")).toEqual({
		kind: "deleted",
		label: "deleted",
	});
	expect(describeChangeStatus("R ")).toEqual({
		kind: "renamed",
		label: "renamed",
	});
	for (const conflict of ["UU", "AU", "DU", "AA", "DD"]) {
		expect(describeChangeStatus(conflict)).toEqual({
			kind: "conflicted",
			label: "conflicted",
		});
	}
	expect(describeChangeStatus("XY")).toEqual({ kind: "unknown", label: "XY" });
});

it("renders PRECONDITION_FAILED as an explanation without a retry", async () => {
	store.error = new ORPCError("PRECONDITION_FAILED", {
		message: "Computer is not connected — reconnect it and retry",
	});
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText(RECONNECT_PATTERN)).toBeDefined();
	});
	expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("renders TIMEOUT as a timeout with a retry", async () => {
	store.error = new ORPCError("TIMEOUT", {
		message: "project query timed out after 10s",
	});
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText(TIMEOUT_PATTERN)).toBeDefined();
	});
	expect(view.getByRole("button", { name: "Retry" })).toBeDefined();
});

it("renders BAD_REQUEST with the server's message verbatim", async () => {
	store.error = new ORPCError("BAD_REQUEST", {
		message: "path escapes the project",
	});
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText("path escapes the project")).toBeDefined();
	});
	expect(view.getByRole("button", { name: "Retry" })).toBeDefined();
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
