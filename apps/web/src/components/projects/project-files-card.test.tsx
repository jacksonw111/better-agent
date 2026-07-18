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
import { ProjectFilesCard } from "./project-files-card";
import type { ProjectFsEntry } from "./project-query";

// Q3: the project detail's Files card — a read-only browse of the checkout
// via projects.query fs_list: click a directory to drill in, breadcrumbs to
// climb back out, and an explanation state while the checkout can't be read.

const SRC_PATTERN = /src/;
const CLONING_PATTERN = /still being cloned/;
const OFFLINE_PATTERN = /offline/;
const RECONNECT_PATTERN = /reconnect it and retry/;
const TIMEOUT_PATTERN = /did not answer in time/;

const store = vi.hoisted(() => ({
	entriesByPath: {} as Record<string, unknown[]>,
	error: null as unknown,
	paths: [] as string[],
}));

vi.mock("./project-query", () => ({
	projectFsListOptions: (projectId: string, path: string) => ({
		queryKey: ["projects", "query", projectId, "fs_list", path],
		queryFn: () => {
			store.paths.push(path);
			if (store.error) {
				return Promise.reject(store.error);
			}
			return Promise.resolve({ entries: store.entriesByPath[path] ?? [] });
		},
	}),
}));

const ROOT_ENTRIES: ProjectFsEntry[] = [
	{ kind: "file", name: "README.md", size: 2048 },
	{ kind: "dir", name: "src" },
	{ kind: "file", name: "package.json", size: 512 },
];

const SRC_ENTRIES: ProjectFsEntry[] = [
	{ kind: "file", name: "index.ts", size: 64 },
];

function renderCard(overrides: { online?: boolean; status?: string } = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ProjectFilesCard
				online={overrides.online ?? true}
				projectId="project-1"
				status={(overrides.status ?? "ready") as "ready"}
			/>
		</QueryClientProvider>
	);
	return { view: within(container) };
}

afterEach(() => {
	store.entriesByPath = {};
	store.error = null;
	store.paths.length = 0;
	cleanup();
});

it("lists the checkout root, directories before files", async () => {
	store.entriesByPath = { "": ROOT_ENTRIES };
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText("src")).toBeDefined();
	});
	expect(store.paths).toEqual([""]);
	const names = view
		.getAllByTestId("fs-entry")
		.map((row) => row.getAttribute("data-name"));
	expect(names).toEqual(["src", "package.json", "README.md"]);
});

it("drills into a directory and climbs back out through the breadcrumb", async () => {
	store.entriesByPath = { "": ROOT_ENTRIES, src: SRC_ENTRIES };
	const { view } = renderCard();
	await waitFor(() => {
		expect(view.getByText("src")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: SRC_PATTERN }));
	await waitFor(() => {
		expect(view.getByText("index.ts")).toBeDefined();
	});
	expect(store.paths).toContain("src");
	// The breadcrumb now shows the path; root climbs back out.
	const breadcrumb = view.getByRole("navigation", { name: "Path" });
	fireEvent.click(within(breadcrumb).getByRole("button", { name: "root" }));
	await waitFor(() => {
		expect(view.getByText("README.md")).toBeDefined();
	});
});

it("explains an empty directory instead of a blank", async () => {
	store.entriesByPath = { "": [] };
	const { view } = renderCard();

	await waitFor(() => {
		expect(view.getByText("This directory is empty.")).toBeDefined();
	});
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

it("explains a not-ready project or offline computer instead of querying", () => {
	const cloning = renderCard({ status: "cloning" });
	expect(cloning.view.getByText(CLONING_PATTERN)).toBeDefined();
	cleanup();

	const offline = renderCard({ online: false });
	expect(offline.view.getByText(OFFLINE_PATTERN)).toBeDefined();
	expect(store.paths).toEqual([]);
});
