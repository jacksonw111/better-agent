// @vitest-environment jsdom
// P3 history continuity + fix-crash-2: a resumed session is ONE thread — the
// previous runs' transcripts are reachable above the live feed, but each one
// starts as a COLLAPSED one-line summary (no fetch, no mounted turns) and, on
// expand, lazily fetches its history and mounts only the trailing
// FEED_WINDOW_SIZE turns behind the shared "Show earlier" control. Eagerly
// fetching and fully mounting up to 3 long transcripts is what moved the
// "Aw, Snap" tab OOM from the live feed into this leading slot.

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FEED_WINDOW_SIZE } from "@/components/bridge/turn-window";
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
const EARLIER_RUN_PATTERN = /Earlier run/;
const EXPANDED_SUMMARY_PATTERN = /Earlier run · 1 条消息/;
const SHOW_EARLIER_PATTERN = /Show earlier messages/;
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
	messages: string[]
) {
	const session = makeTaskSession({
		id: `session-${ordinal}`,
		runId: `run-${ordinal}`,
		status: status === "running" ? "active" : "ended",
		tokenId: `token-${ordinal}`,
	});
	store.historyBySession[session.id] = messages.map((text, index) => ({
		event: { kind: "message", role: "user", text },
		seq: index + 1,
	}));
	return makeTaskRun({
		createdAt: new Date(Date.now() - hoursAgo * HOUR_MS),
		id: `run-${ordinal}`,
		session,
		sessionId: session.id,
		status,
	});
}

function seedThreeRunSession() {
	store.detail = makeTaskDetail({
		runs: [
			seedRun(1, 2, "completed", [FIRST_RUN_REPLY]),
			seedRun(2, 1, "stopped", [SECOND_RUN_REPLY]),
			seedRun(3, 0, "running", [LIVE_REPLY]),
		],
	});
}

it("renders prior runs collapsed by default, without fetching their history", async () => {
	seedThreeRunSession();
	const { view } = renderTaskConversation(TaskConversation);

	// The live run's feed streams as usual…
	await waitFor(() => {
		expect(view.getByText(LIVE_REPLY)).toBeDefined();
	});
	// …while each prior run is exactly one summary row: no transcript text in
	// the DOM, and — the data-layer half of the OOM fix — no history fetch at
	// all for a collapsed run.
	expect(view.getAllByText(EARLIER_RUN_PATTERN).length).toBe(2);
	expect(view.queryByText(FIRST_RUN_REPLY)).toBeNull();
	expect(view.queryByText(SECOND_RUN_REPLY)).toBeNull();
	expect(store.historyCalls).not.toContain("session-1");
	expect(store.historyCalls).not.toContain("session-2");
	// The live terminal only ever connects to the CURRENT run's session.
	expect(store.connectedSessionIds).toEqual(["session-3"]);
});

it("expanding one prior run fetches and renders ONLY that run's transcript", async () => {
	seedThreeRunSession();
	const { view } = renderTaskConversation(TaskConversation);
	await waitFor(() => {
		expect(view.getByText(LIVE_REPLY)).toBeDefined();
	});

	const [firstSummary] = view.getAllByRole("button", {
		name: EARLIER_RUN_PATTERN,
	});
	fireEvent.click(firstSummary as HTMLElement);

	await waitFor(() => {
		expect(view.getByText(FIRST_RUN_REPLY)).toBeDefined();
	});
	// The sibling prior run stays collapsed AND unfetched.
	expect(view.queryByText(SECOND_RUN_REPLY)).toBeNull();
	expect(store.historyCalls).toContain("session-1");
	expect(store.historyCalls).not.toContain("session-2");
	// Collapsing again unmounts the transcript (the cached history stays).
	fireEvent.click(view.getByRole("button", { name: EXPANDED_SUMMARY_PATTERN }));
	expect(view.queryByText(FIRST_RUN_REPLY)).toBeNull();
});

it("an expanded transcript mounts only the trailing feed window behind Show earlier", async () => {
	const overflow = 10;
	const total = FEED_WINDOW_SIZE + overflow;
	const messages = Array.from({ length: total }, (_, i) => `old-msg-${i + 1}`);
	store.detail = makeTaskDetail({
		runs: [
			seedRun(1, 1, "completed", messages),
			seedRun(2, 0, "running", [LIVE_REPLY]),
		],
	});
	const { view } = renderTaskConversation(TaskConversation);
	await waitFor(() => {
		expect(view.getByText(LIVE_REPLY)).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: EARLIER_RUN_PATTERN }));

	// Only the trailing FEED_WINDOW_SIZE turns mount; the earliest hide behind
	// the shared expand control.
	await waitFor(() => {
		expect(view.getByText(`old-msg-${total}`)).toBeDefined();
	});
	expect(view.getByText(`old-msg-${overflow + 1}`)).toBeDefined();
	expect(view.queryByText(`old-msg-${overflow}`)).toBeNull();
	const expand = view.getByRole("button", { name: SHOW_EARLIER_PATTERN });
	expect(expand.textContent).toContain(`还有 ${overflow} 条`);

	fireEvent.click(expand);
	expect(view.getByText("old-msg-1")).toBeDefined();
});
