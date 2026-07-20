// The pure shaping behind the global active-session indicator: how the flat
// tasks.listActive rows become the popover's computer → project → session
// tree, and how the trigger's badge/attention state is derived. The rendering
// contract lives in active-sessions-indicator.test.tsx.

import { expect, it } from "vitest";
import type { ActiveSessionItem } from "./active-sessions";
import {
	activeSessionsSummary,
	countActiveByProject,
	groupActiveSessions,
} from "./active-sessions";

const MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 600_000;
const THIRTY_MINUTES_MS = 1_800_000;

function makeActive(
	overrides: Partial<ActiveSessionItem> & { taskId: string }
): ActiveSessionItem {
	return {
		agentKind: "claude-code",
		computerId: "computer-1",
		computerName: "MacBook Pro",
		lastActivityAt: new Date(Date.now() - MINUTE_MS).toISOString(),
		name: "Fix login redirect",
		needsAttention: false,
		projectId: null,
		projectName: null,
		runId: `run-${overrides.taskId}`,
		status: "running",
		...overrides,
	};
}

it("summarises an empty list as the quiet state", () => {
	expect(activeSessionsSummary([])).toEqual({
		attentionCount: 0,
		needsAttention: false,
		total: 0,
	});
});

it("counts the sessions waiting on the user separately from the total", () => {
	const summary = activeSessionsSummary([
		makeActive({ taskId: "task-1" }),
		makeActive({ needsAttention: true, taskId: "task-2" }),
		makeActive({ needsAttention: true, taskId: "task-3" }),
	]);

	expect(summary).toEqual({
		attentionCount: 2,
		needsAttention: true,
		total: 3,
	});
});

it("groups by computer, then by project, keeping first-seen order", () => {
	const groups = groupActiveSessions([
		makeActive({ taskId: "task-1" }),
		makeActive({
			computerId: "computer-2",
			computerName: "Studio",
			taskId: "task-2",
		}),
		makeActive({
			projectId: "project-1",
			projectName: "better-agent",
			taskId: "task-3",
		}),
	]);

	expect(groups.map((group) => group.computerId)).toEqual([
		"computer-1",
		"computer-2",
	]);
	expect(groups[0].computerName).toBe("MacBook Pro");
	// Project-less sessions stay first within a computer, then each project.
	expect(groups[0].projects.map((project) => project.projectId)).toEqual([
		null,
		"project-1",
	]);
	expect(groups[0].projects[1].projectName).toBe("better-agent");
	expect(
		groups[0].projects[1].sessions.map((session) => session.taskId)
	).toEqual(["task-3"]);
	expect(groups[1].projects[0].sessions.map((s) => s.taskId)).toEqual([
		"task-2",
	]);
});

it("floats the sessions waiting on you to the top, then orders by recency", () => {
	const now = Date.now();
	const groups = groupActiveSessions([
		makeActive({
			lastActivityAt: new Date(now - TEN_MINUTES_MS).toISOString(),
			taskId: "stale",
		}),
		makeActive({
			lastActivityAt: new Date(now - MINUTE_MS).toISOString(),
			taskId: "fresh",
		}),
		makeActive({
			lastActivityAt: new Date(now - THIRTY_MINUTES_MS).toISOString(),
			needsAttention: true,
			taskId: "waiting",
		}),
	]);

	expect(
		groups[0].projects[0].sessions.map((session) => session.taskId)
	).toEqual(["waiting", "fresh", "stale"]);
});

it("rolls active sessions up per project, ignoring the project-less ones", () => {
	const counts = countActiveByProject([
		makeActive({ taskId: "task-1" }),
		makeActive({ projectId: "project-1", projectName: "a", taskId: "task-2" }),
		makeActive({
			needsAttention: true,
			projectId: "project-1",
			projectName: "a",
			taskId: "task-3",
		}),
		makeActive({ projectId: "project-2", projectName: "b", taskId: "task-4" }),
	]);

	expect(counts["project-1"]).toEqual({
		attentionCount: 1,
		needsAttention: true,
		total: 2,
	});
	expect(counts["project-2"]).toEqual({
		attentionCount: 0,
		needsAttention: false,
		total: 1,
	});
	// The project-less session belongs to the computer, not to any row.
	expect(Object.keys(counts)).toHaveLength(2);
});

it("gives every project group a stable key, so a null project can't collide", () => {
	const groups = groupActiveSessions([
		makeActive({ taskId: "task-1" }),
		makeActive({ projectId: "project-1", projectName: "p", taskId: "task-2" }),
	]);
	const keys = groups[0].projects.map((project) => project.key);

	expect(new Set(keys).size).toBe(keys.length);
});
