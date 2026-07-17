// @vitest-environment jsdom
// P3 session lifecycle: entering a settled session auto-resumes it (a new run
// continuing the same thread) behind a loading veil; switching to a sibling
// session stops the live process first, then navigates; the header offers
// Stop while the agent is live; a failed resume surfaces its error with a
// retry, outside the chat. The pure conversation-content contract lives in
// task-conversation.test.tsx (300-line file cap).

import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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

const RESUMING_LABEL = "正在恢复会话…";
const STOPPING_LABEL = "正在结束当前会话…";
const OFFLINE_ERROR = "Computer is offline";
const HOUR_MS = 3_600_000;
const SIBLING_ROW_PATTERN = /Refactor auth/;

afterEach(cleanup);
beforeEach(resetTaskStore);

function liveDetail() {
	const session = makeTaskSession({ id: "session-1", runId: "run-1" });
	return makeTaskDetail({
		runs: [
			makeTaskRun({
				id: "run-1",
				session,
				sessionId: session.id,
				status: "running",
			}),
		],
	});
}

function settledDetail(status = "stopped") {
	const session = makeTaskSession({ id: "session-1", runId: "run-1" });
	return makeTaskDetail({
		runs: [
			makeTaskRun({ id: "run-1", session, sessionId: session.id, status }),
		],
	});
}

function siblingSessions() {
	return [
		makeSessionListItem({ id: "task-1", name: "Fix login redirect" }),
		makeSessionListItem({
			createdAt: new Date(Date.now() - HOUR_MS),
			id: "task-2",
			name: "Refactor auth",
		}),
	];
}

it("auto-resumes a settled session on entry behind the loading veil, until the new run is live", async () => {
	store.detail = settledDetail("completed");
	const { queryClient, view } = renderTaskConversation(TaskConversation);

	// Entering the ended session calls tasks.resume by itself (the "can't
	// reopen an ended session" fix) and veils the chat meanwhile.
	await waitFor(() => {
		expect(store.resumeCalls).toEqual(["task-1"]);
	});
	await waitFor(() => {
		expect(view.getByText(RESUMING_LABEL)).toBeDefined();
	});

	// The appended run comes back live -> the veil lifts.
	const session2 = makeTaskSession({
		id: "session-2",
		runId: "run-next",
		tokenId: "token-run-next",
	});
	store.detail = makeTaskDetail({
		runs: [
			...settledDetail("completed").runs,
			makeTaskRun({
				createdAt: new Date(Date.now() + 1),
				id: "run-next",
				session: session2,
				sessionId: session2.id,
				status: "running",
			}),
		],
	});
	await queryClient.invalidateQueries();
	await waitFor(() => {
		expect(view.queryByText(RESUMING_LABEL)).toBeNull();
	});
	// The conversation follows the resumed run's session.
	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-2");
	});
});

it("never auto-resumes a session whose run is still live", async () => {
	store.detail = liveDetail();
	const { view } = renderTaskConversation(TaskConversation);

	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-1");
	});
	expect(store.resumeCalls).toEqual([]);
	expect(view.queryByText(RESUMING_LABEL)).toBeNull();
});

it("surfaces a failed resume outside the chat, with a retry that resumes again", async () => {
	store.detail = settledDetail();
	store.resumeError = OFFLINE_ERROR;
	const { view } = renderTaskConversation(TaskConversation);

	const alert = await waitFor(() => view.getByRole("alert"));
	expect(alert.textContent).toContain("Couldn't resume this session");
	expect(alert.textContent).toContain(OFFLINE_ERROR);
	// The veil lifts so the error is actionable, and history stays readable.
	expect(view.queryByText(RESUMING_LABEL)).toBeNull();

	store.resumeError = null;
	fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
	await waitFor(() => {
		expect(store.resumeCalls).toEqual(["task-1", "task-1"]);
	});
});

it("stops the live session before switching to a sibling, then navigates", async () => {
	store.detail = liveDetail();
	store.sessions = siblingSessions();
	const { view } = renderTaskConversation(TaskConversation);

	const sidebar = await waitFor(() =>
		view.getByRole("navigation", { name: "Sessions" })
	);
	const target = await waitFor(() =>
		within(sidebar).getByRole("button", { name: SIBLING_ROW_PATTERN })
	);
	fireEvent.click(target);

	// Stop first (the same bridge.endSession path as the header's Stop) …
	await waitFor(() => {
		expect(store.endSessionCalls).toEqual(["session-1"]);
	});
	// … then navigate to the target session, whose own mount resumes it.
	await waitFor(() => {
		expect(store.navigations).toEqual(["task-2"]);
	});
	expect(store.resumeCalls).toEqual([]);
});

it("switches away from a settled session without stopping anything", async () => {
	store.detail = settledDetail();
	store.sessions = siblingSessions();
	const { view } = renderTaskConversation(TaskConversation);

	const sidebar = await waitFor(() =>
		view.getByRole("navigation", { name: "Sessions" })
	);
	fireEvent.click(
		await waitFor(() =>
			within(sidebar).getByRole("button", { name: SIBLING_ROW_PATTERN })
		)
	);

	await waitFor(() => {
		expect(store.navigations).toEqual(["task-2"]);
	});
	expect(store.endSessionCalls).toEqual([]);
	expect(view.queryByText(STOPPING_LABEL)).toBeNull();
});

it("offers Stop in the header while the agent is live, ending the run's session", async () => {
	store.detail = liveDetail();
	const { view } = renderTaskConversation(TaskConversation);

	const stop = await waitFor(() => view.getByRole("button", { name: "Stop" }));
	fireEvent.click(stop);

	await waitFor(() => {
		expect(store.endSessionCalls).toEqual(["session-1"]);
	});
	// Stop is not a navigation and not a resume.
	expect(store.navigations).toEqual([]);
	expect(store.resumeCalls).toEqual([]);
});

it("hides Stop once the run has settled", async () => {
	store.detail = settledDetail();
	const { view } = renderTaskConversation(TaskConversation);

	await waitFor(() => {
		expect(store.resumeCalls).toEqual(["task-1"]);
	});
	expect(view.queryByRole("button", { name: "Stop" })).toBeNull();
});
