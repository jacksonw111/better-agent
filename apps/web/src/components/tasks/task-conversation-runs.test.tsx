// @vitest-environment jsdom
// S3-T2 Run inspection (master spec §11/§16): the failed run's REAL error and
// its Retry live OUTSIDE the message history; retry appends a new sequential
// run and the page follows it; older runs stay reachable through the run
// switcher. The pure conversation-content contract lives in
// task-conversation.test.tsx (300-line file cap).

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskConversation } from "./task-conversation";
import {
	makeTaskDetail,
	makeTaskRun,
	makeTaskSession,
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

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...rest }: { children?: React.ReactNode; to: string }) => (
		<a href={rest.to}>{children}</a>
	),
}));

const REAL_ERROR = "git clone failed: repository not found";
const HOUR_MS = 3_600_000;
const OPENING_PATTERN = /Fix the login redirect bug/;

afterEach(cleanup);
beforeEach(resetTaskStore);

function failedDetail() {
	return makeTaskDetail({
		runs: [
			makeTaskRun({
				errorMessage: REAL_ERROR,
				id: "run-1",
				status: "failed",
			}),
		],
	});
}

it("shows the failed run's real error and Retry OUTSIDE the chat, with no lifecycle chat messages", async () => {
	store.detail = failedDetail();
	const { container, view } = renderTaskConversation(TaskConversation);

	const alert = await waitFor(() => view.getByRole("alert"));
	expect(alert.textContent).toContain(REAL_ERROR);
	expect(view.getByRole("button", { name: "Retry" })).toBeDefined();

	// Outside the chat: neither the error nor any lifecycle text is a message.
	const chat = container.querySelector('[data-testid="task-chat"]');
	expect(chat?.textContent).not.toContain(REAL_ERROR);
	expect(chat?.textContent).not.toContain("Failed");
	expect(chat?.textContent).toContain("Fix the login redirect bug");
});

it("retry calls tasks.retry and the page follows the NEW run", async () => {
	store.detail = failedDetail();
	store.retryResult = { runId: "run-2" };
	const { view } = renderTaskConversation(TaskConversation);
	const retry = await waitFor(() =>
		view.getByRole("button", { name: "Retry" })
	);

	// The refetch after the mutation returns the appended sequential run.
	const session2 = makeTaskSession({
		id: "session-2",
		runId: "run-2",
		tokenId: "token-run-2",
	});
	store.detail = makeTaskDetail({
		runs: [
			...failedDetail().runs,
			makeTaskRun({
				createdAt: new Date(Date.now() + 1),
				id: "run-2",
				session: session2,
				sessionId: session2.id,
				status: "running",
			}),
		],
	});
	fireEvent.click(retry);

	await waitFor(() => {
		expect(store.retryCalls).toEqual(["task-1"]);
	});
	// The new run's session terminal mounts and the failed banner clears.
	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-2");
	});
	expect(view.queryByRole("alert")).toBeNull();
	expect(view.getByText("Running")).toBeDefined();
});

it("defaults to the latest run and switches to an older run's conversation on demand", async () => {
	const session1 = makeTaskSession({ id: "session-1", runId: "run-1" });
	const session2 = makeTaskSession({
		id: "session-2",
		runId: "run-2",
		tokenId: "token-run-2",
	});
	store.detail = makeTaskDetail({
		runs: [
			makeTaskRun({
				createdAt: new Date(Date.now() - HOUR_MS),
				errorMessage: REAL_ERROR,
				id: "run-1",
				session: session1,
				sessionId: session1.id,
				status: "failed",
			}),
			makeTaskRun({
				id: "run-2",
				session: session2,
				sessionId: session2.id,
				status: "running",
			}),
		],
	});
	const { view } = renderTaskConversation(TaskConversation);

	// Latest run wins by default.
	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-2");
	});
	expect(store.connectedSessionIds).not.toContain("session-1");

	// The switcher exposes the sequential history; picking Run 1 remounts the
	// terminal onto ITS session and surfaces its real error.
	fireEvent.click(view.getByRole("button", { name: "Run 1" }));
	await waitFor(() => {
		expect(store.connectedSessionIds).toContain("session-1");
	});
	const alert = view.getByRole("alert");
	expect(alert.textContent).toContain(REAL_ERROR);
});

it("hides the run switcher while the task has a single run", async () => {
	store.detail = failedDetail();
	const { view } = renderTaskConversation(TaskConversation);

	await waitFor(() => {
		expect(view.getByText(OPENING_PATTERN)).toBeDefined();
	});
	expect(view.queryByRole("button", { name: "Run 1" })).toBeNull();
});
