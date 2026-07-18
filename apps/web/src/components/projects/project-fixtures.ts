import type { ProjectListItem } from "@/utils/api-types";

// Shared fixtures for the Project (Q3) Testing Library suites: one factory
// covering every clone status, so the chip/list/detail tests never hand-roll
// rows. Not a `*.test.*` file, so vitest's include skips it.

export function makeProject(
	overrides: Partial<ProjectListItem> = {}
): ProjectListItem {
	return {
		computerId: "computer-1",
		createdAt: new Date("2026-07-15T10:00:00.000Z"),
		errorMessage: null,
		id: "project-1",
		localPath: null,
		name: "Better Agent",
		repoCloneUrl: "https://github.com/acme/better-agent.git",
		repoFullName: "acme/better-agent",
		status: "created",
		tokenLast4: null,
		updatedAt: new Date("2026-07-15T10:00:00.000Z"),
		...overrides,
	};
}

/** Cloned and usable — sessions can start from it. */
export const readyProject = makeProject({
	localPath: "/Users/dev/.better-agent/projects/project1-better-agent",
	status: "ready",
});

/** Clone failed — the row carries the REAL failure message. */
export const erroredProject = makeProject({
	errorMessage: "Authentication failed for repository",
	id: "project-err",
	name: "Private Repo",
	repoFullName: "acme/private-repo",
	status: "error",
});
