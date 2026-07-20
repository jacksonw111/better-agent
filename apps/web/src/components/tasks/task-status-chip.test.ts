// Status semantics shared by every session surface (the sidebar, the agent
// session list, the project picker, the global indicator). Sessions are
// long-lived now, so "is this still working" and "is this blocked on me" are
// two DIFFERENT questions — the second must never hide inside the first.

import { expect, it } from "vitest";
import {
	isLiveRunStatus,
	runNeedsAttention,
	runStatusLabel,
} from "./task-status-chip";

it("treats every pre-launch and working status as live", () => {
	for (const status of [
		"created",
		"launching",
		"preparing_workspace",
		"running",
		"starting_runtime",
		"waiting_for_user",
	] as const) {
		expect(isLiveRunStatus(status)).toBe(true);
	}
});

it("treats the settled statuses — and no run at all — as not live", () => {
	for (const status of ["completed", "failed", "stopped"] as const) {
		expect(isLiveRunStatus(status)).toBe(false);
	}
	expect(isLiveRunStatus(null)).toBe(false);
});

it("only flags the status that is actually blocked on the user", () => {
	expect(runNeedsAttention("waiting_for_user")).toBe(true);
	expect(runNeedsAttention("running")).toBe(false);
	expect(runNeedsAttention("failed")).toBe(false);
	expect(runNeedsAttention(null)).toBe(false);
});

it("labels the waiting state as addressed to the user", () => {
	expect(runStatusLabel("waiting_for_user")).toBe("Waiting for you");
	expect(runStatusLabel("running")).toBe("Running");
});
