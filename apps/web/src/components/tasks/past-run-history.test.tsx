// @vitest-environment jsdom
// P3 history continuity: a resumed session is ONE thread — the previous runs'
// persisted bridge history replays read-only above the live feed, in run
// order, capped at PRIOR_RUN_HISTORY_LIMIT prior runs.

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskRun } from "@/utils/api-types";
import { PRIOR_RUN_HISTORY_LIMIT, priorRunsOf } from "./past-run-history";
import { TaskConversation } from "./task-conversation";
import {
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

const HOUR_MS = 3_600_000;
const EARLIER_RUN_PATTERN = /Earlier run ·/;
const FIRST_RUN_REPLY = "I fixed the redirect in the auth callback.";
const SECOND_RUN_REPLY = "Added the regression test as asked.";
const LIVE_REPLY = "Continuing from where we left off.";

afterEach(cleanup);
beforeEach(resetTaskStore);

function runAt(
	offsetMs: number,
	overrides: { id: string; sessionId: string | null }
): TaskRun {
	return makeTaskRun({
		createdAt: new Date(Date.now() + offsetMs),
		...overrides,
	}) as unknown as TaskRun;
}

it("priorRunsOf keeps only session-bound runs before the current one, capped at the limit", () => {
	const runs = [
		runAt(-5 * HOUR_MS, { id: "run-1", sessionId: "s1" }),
		runAt(-4 * HOUR_MS, { id: "run-2", sessionId: null }),
		runAt(-3 * HOUR_MS, { id: "run-3", sessionId: "s3" }),
		runAt(-2 * HOUR_MS, { id: "run-4", sessionId: "s4" }),
		runAt(-1 * HOUR_MS, { id: "run-5", sessionId: "s5" }),
		runAt(0, { id: "run-6", sessionId: "s6" }),
	];

	const prior = priorRunsOf(runs, "run-6");

	// run-2 never bound a session; run-1 falls off the cap; order is oldest
	// first so the stack reads top-down in time order.
	expect(PRIOR_RUN_HISTORY_LIMIT).toBe(3);
	expect(prior.map((run) => run.id)).toEqual(["run-3", "run-4", "run-5"]);
});

/** One session-bound run at an hour offset, its transcript seeded into the
 * transport's history store. */
function seedRun(
	ordinal: number,
	hoursAgo: number,
	status: string,
	reply: string
) {
	const session = makeTaskSession({
		id: `session-${ordinal}`,
		runId: `run-${ordinal}`,
		status: status === "running" ? "active" : "ended",
		tokenId: `token-${ordinal}`,
	});
	store.historyBySession[session.id] = [
		{ event: { kind: "message", role: "assistant", text: reply }, seq: 1 },
	];
	return makeTaskRun({
		createdAt: new Date(Date.now() - hoursAgo * HOUR_MS),
		id: `run-${ordinal}`,
		session,
		sessionId: session.id,
		status,
	});
}

it("replays the previous runs' history above the live feed, in run order", async () => {
	store.detail = makeTaskDetail({
		runs: [
			seedRun(1, 2, "completed", FIRST_RUN_REPLY),
			seedRun(2, 1, "stopped", SECOND_RUN_REPLY),
			seedRun(3, 0, "running", LIVE_REPLY),
		],
	});
	const { container, view } = renderTaskConversation(TaskConversation);

	// Every transcript is on screen: the two earlier runs replay read-only
	// above the live feed…
	await waitFor(() => {
		expect(view.getByText(FIRST_RUN_REPLY)).toBeDefined();
		expect(view.getByText(SECOND_RUN_REPLY)).toBeDefined();
		expect(view.getByText(LIVE_REPLY)).toBeDefined();
	});
	// …in run-time order, before the current run's stream (textContent
	// traversal is document order).
	const text = container.textContent ?? "";
	expect(text.indexOf(FIRST_RUN_REPLY)).toBeLessThan(
		text.indexOf(SECOND_RUN_REPLY)
	);
	expect(text.indexOf(SECOND_RUN_REPLY)).toBeLessThan(text.indexOf(LIVE_REPLY));
	// Each replayed block announces itself as an earlier run.
	expect(view.getAllByText(EARLIER_RUN_PATTERN).length).toBe(2);
	// The live terminal only ever connects to the CURRENT run's session — the
	// replayed runs are plain read-only content.
	expect(store.connectedSessionIds).toEqual(["session-3"]);
});
