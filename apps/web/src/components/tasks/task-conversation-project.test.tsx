// @vitest-environment jsdom
// Q3: the chat window's project adaptations — a project session's sibling
// sidebar lists only sessions of the SAME project, the header names the
// project and links back to its detail page, and a plain (no-project)
// session keeps the old behavior: every sibling listed, no project chip.

import { cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskConversation } from "./task-conversation";
import {
	makeSessionListItem,
	makeTaskDetail,
	makeTaskRun,
	makeTaskSession,
} from "./task-conversation-fixtures";
import {
	renderTaskConversation,
	resetTaskStore,
	taskStore as store,
} from "./task-conversation-test-utils";

vi.mock("@/utils/orpc", async () => {
	const mocks = await import("./task-conversation-test-utils");
	return mocks.buildTaskOrpcMock();
});

vi.mock("@/components/bridge/bridge-transport", async () => {
	const utils = await import("./task-conversation-test-utils");
	return utils.buildTaskTransportMock();
});

vi.mock("@tanstack/react-router", async () => {
	const utils = await import("./task-conversation-test-utils");
	return utils.buildTaskRouterMock();
});

const PROJECT_LINK_PATTERN = /Better Agent/;

afterEach(cleanup);
beforeEach(resetTaskStore);

function liveProjectDetail(projectId: string | null) {
	const session = makeTaskSession({ id: "session-1", runId: "run-1" });
	const detail = makeTaskDetail({
		runs: [
			makeTaskRun({
				id: "run-1",
				session,
				sessionId: session.id,
				status: "running",
			}),
		],
	});
	detail.task.projectId = projectId;
	return detail;
}

function mixedSiblings() {
	return [
		makeSessionListItem({
			id: "task-1",
			name: "Fix login redirect",
			projectId: "project-1",
		}),
		makeSessionListItem({
			id: "task-2",
			name: "Same project",
			projectId: "project-1",
		}),
		makeSessionListItem({
			id: "task-3",
			name: "Other project",
			projectId: "project-9",
		}),
		makeSessionListItem({ id: "task-4", name: "No project", projectId: null }),
	];
}

it("filters a project session's sibling sidebar to the same project", async () => {
	store.detail = liveProjectDetail("project-1");
	store.project = { id: "project-1", name: "Better Agent" };
	store.sessions = mixedSiblings();
	const { view } = renderTaskConversation(TaskConversation);

	const sidebar = await waitFor(() =>
		view.getByRole("navigation", { name: "Sessions" })
	);
	await waitFor(() => {
		expect(within(sidebar).getByText("Same project")).toBeDefined();
	});
	expect(within(sidebar).queryByText("Other project")).toBeNull();
	expect(within(sidebar).queryByText("No project")).toBeNull();
});

it("keeps every sibling for a session without a project", async () => {
	store.detail = liveProjectDetail(null);
	store.sessions = mixedSiblings();
	const { view } = renderTaskConversation(TaskConversation);

	const sidebar = await waitFor(() =>
		view.getByRole("navigation", { name: "Sessions" })
	);
	await waitFor(() => {
		expect(within(sidebar).getByText("Other project")).toBeDefined();
	});
	expect(within(sidebar).getByText("No project")).toBeDefined();
});

it("names the project in the header, linking back to its detail page", async () => {
	store.detail = liveProjectDetail("project-1");
	store.project = { id: "project-1", name: "Better Agent" };
	const { view } = renderTaskConversation(TaskConversation);

	const link = await waitFor(() =>
		view.getByRole("link", { name: PROJECT_LINK_PATTERN })
	);
	expect(link.getAttribute("href")).toBe(
		"/computers/computer-1/projects/project-1"
	);
});

it("shows no project chip for a plain session", async () => {
	store.detail = liveProjectDetail(null);
	const { view } = renderTaskConversation(TaskConversation);

	await waitFor(() => {
		expect(view.getByText("Fix login redirect")).toBeDefined();
	});
	expect(view.queryByRole("link", { name: PROJECT_LINK_PATTERN })).toBeNull();
});
