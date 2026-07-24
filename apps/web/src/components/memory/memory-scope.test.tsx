// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
	MemoryScopeBadge,
	matchesScopeFilter,
	type ProjectOption,
	SCOPE_FILTER_ALL,
	SCOPE_FILTER_GLOBAL,
} from "./memory-scope";

const projects: ProjectOption[] = [
	{ id: "proj-a", name: "Alpha" },
	{ id: "proj-b", name: "Beta" },
];

afterEach(cleanup);

it("matchesScopeFilter: All matches everything", () => {
	expect(
		matchesScopeFilter({ scope: "global", projectId: null }, SCOPE_FILTER_ALL)
	).toBe(true);
	expect(
		matchesScopeFilter(
			{ scope: "project", projectId: "proj-a" },
			SCOPE_FILTER_ALL
		)
	).toBe(true);
});

it("matchesScopeFilter: Global matches only global memories", () => {
	expect(
		matchesScopeFilter(
			{ scope: "global", projectId: null },
			SCOPE_FILTER_GLOBAL
		)
	).toBe(true);
	expect(
		matchesScopeFilter(
			{ scope: "project", projectId: "proj-a" },
			SCOPE_FILTER_GLOBAL
		)
	).toBe(false);
});

it("matchesScopeFilter: a projectId filter matches only that project's memories", () => {
	expect(
		matchesScopeFilter({ scope: "project", projectId: "proj-a" }, "proj-a")
	).toBe(true);
	expect(
		matchesScopeFilter({ scope: "project", projectId: "proj-b" }, "proj-a")
	).toBe(false);
	expect(
		matchesScopeFilter({ scope: "global", projectId: null }, "proj-a")
	).toBe(false);
});

it("MemoryScopeBadge shows Global for a global memory", () => {
	const { container } = render(
		<MemoryScopeBadge
			memory={{ scope: "global", projectId: null }}
			projects={projects}
		/>
	);
	expect(within(container).getByText("Global")).toBeDefined();
});

it("MemoryScopeBadge shows the project name for a project memory", () => {
	const { container } = render(
		<MemoryScopeBadge
			memory={{ scope: "project", projectId: "proj-b" }}
			projects={projects}
		/>
	);
	expect(within(container).getByText("Beta")).toBeDefined();
});
