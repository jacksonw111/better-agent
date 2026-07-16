// @vitest-environment jsdom
// S3-T2 Conversation contract (master spec §18.4): the Opening Message is the
// FIRST visible message and keeps /skill references verbatim; the CLI's
// origin-tagged task-start injection folds collapsed; a run with no bound
// session shows NO fabricated chat. Run/retry flows live in
// task-conversation-runs.test.tsx (300-line file cap).

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

const SKILL_REFERENCE = /\/tdd/;
const FOLLOW_UP = "Also add a regression test.";
const OPENING_PATTERN = /Fix the login redirect bug/;
const ENVIRONMENT_PATTERN = /Agent environment/;
const NO_OUTPUT_PATTERN = /No output yet/;
const SEND_TO_BEGIN_PATTERN = /Send a message to begin/;
const LOCKED_FAILED_PATTERN = /this run is failed/i;
const LOCKED_ANY_PATTERN = /this run is/i;

afterEach(cleanup);
beforeEach(resetTaskStore);

function detailWithBoundSession() {
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

it("renders the opening message as the conversation's first message, /skill text verbatim", async () => {
	store.detail = detailWithBoundSession();
	store.historyBySession["session-1"] = [
		{ event: { kind: "message", role: "user", text: FOLLOW_UP }, seq: 2 },
	];
	const { container, view } = renderTaskConversation(TaskConversation);

	await waitFor(() => {
		expect(view.getByText(OPENING_PATTERN)).toBeDefined();
	});
	expect(view.getByText(SKILL_REFERENCE)).toBeDefined();

	// The relayed user message renders AFTER the opening message in the feed —
	// textContent traversal is document order, so index order is render order.
	await waitFor(() => {
		expect(view.getByText(FOLLOW_UP)).toBeDefined();
	});
	const feedText = container.textContent ?? "";
	expect(feedText.indexOf("Fix the login redirect bug")).toBeLessThan(
		feedText.indexOf(FOLLOW_UP)
	);
});

it("folds the origin-tagged task-start injection collapsed, expandable to the context", async () => {
	store.detail = detailWithBoundSession();
	store.historyBySession["session-1"] = [
		{
			event: {
				kind: "message",
				origin: "task-start",
				role: "user",
				text: "Fix the login redirect bug\n\n## Agent environment\n- git: installed",
			},
			seq: 1,
		},
	];
	const { view } = renderTaskConversation(TaskConversation);

	const toggle = await waitFor(() =>
		view.getByRole("button", { name: "Task start context sent to agent" })
	);
	expect(view.queryByText(ENVIRONMENT_PATTERN)).toBeNull();

	fireEvent.click(toggle);
	expect(view.getByText(ENVIRONMENT_PATTERN)).toBeDefined();
});

it("shows only the opening message while the run has no session — no fabricated chat, status outside", async () => {
	store.detail = makeTaskDetail({
		runs: [makeTaskRun({ id: "run-1", status: "launching" })],
	});
	const { container, view } = renderTaskConversation(TaskConversation);

	await waitFor(() => {
		expect(view.getByText(OPENING_PATTERN)).toBeDefined();
	});
	// The run status appears as a chip OUTSIDE the chat area, never inside it.
	const chat = container.querySelector('[data-testid="task-chat"]');
	expect(chat).not.toBeNull();
	expect(view.getByText("Launching")).toBeDefined();
	expect(chat?.textContent).not.toContain("Launching");
	// No terminal mounted, no working skeleton, no empty-state prompt.
	expect(store.connectedSessionIds).toEqual([]);
	expect(view.queryByText(NO_OUTPUT_PATTERN)).toBeNull();
	expect(view.queryByText(SEND_TO_BEGIN_PATTERN)).toBeNull();
});

it("locks the composer with an explanation when the run is not running or waiting", async () => {
	const session = makeTaskSession({ id: "session-1", runId: "run-1" });
	store.detail = makeTaskDetail({
		runs: [
			makeTaskRun({
				errorMessage: "runtime exited 1",
				id: "run-1",
				session,
				sessionId: session.id,
				status: "failed",
			}),
		],
	});
	const { view } = renderTaskConversation(TaskConversation);

	await waitFor(() => {
		expect(view.getByText(LOCKED_FAILED_PATTERN)).toBeDefined();
	});

	// A running run keeps the composer unlocked (no explanation line).
	cleanup();
	store.detail = detailWithBoundSession();
	const second = renderTaskConversation(TaskConversation);
	await waitFor(() => {
		expect(second.view.getByText(OPENING_PATTERN)).toBeDefined();
	});
	expect(second.view.queryByText(LOCKED_ANY_PATTERN)).toBeNull();
});
