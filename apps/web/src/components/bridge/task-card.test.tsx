// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { TaskCard } from "./task-card";
import { stripTaskWrapper, type TaskInvocation } from "./task-invocation";

const CURRENTLY_RE = /Currently:/;

function task(partial: Partial<TaskInvocation>): TaskInvocation {
	return {
		callId: "t1",
		resultText: "",
		status: "running",
		title: "Explore project structure",
		toolRuns: [],
		...partial,
	};
}

function renderCard(t: TaskInvocation) {
	const utils = render(<TaskCard task={t} />);
	return { ...utils, scope: within(utils.container) };
}

/** The collapsible trigger is always the FIRST button (the "Show full
 * result" toggle only exists inside the expanded panel, after it). */
function headerOf(scope: ReturnType<typeof within>) {
	return scope.getAllByRole("button")[0];
}

it("strips the <task>/<task_result> XML wrapper down to the inner summary", () => {
	const wrapped =
		'<task id="ses_1" state="completed">\n<task_result>\nfound 3 files\n</task_result>\n</task>';
	expect(stripTaskWrapper(wrapped)).toBe("found 3 files");
});

it("leaves a plain, unwrapped result untouched (Claude's Task tool)", () => {
	expect(stripTaskWrapper("plain summary text")).toBe("plain summary text");
});

it("renders the description as the title and the result in the collapsible body", () => {
	const { scope } = renderCard(
		task({ resultText: "explored the project", status: "complete" })
	);
	expect(scope.getByText("Explore project structure")).toBeDefined();
	fireEvent.click(headerOf(scope));
	expect(scope.getByText("explored the project")).toBeDefined();
});

it("shows the running status before a result has arrived", () => {
	const { scope } = renderCard(task({}));
	expect(scope.getByText("Running…")).toBeDefined();
});

it("shows the failed status for an errored task", () => {
	const { scope } = renderCard(task({ resultText: "boom", status: "error" }));
	expect(scope.getByText("Failed")).toBeDefined();
});

it("shows the currently running tool while the subagent works", () => {
	const { scope } = renderCard(
		task({
			toolRuns: [
				{ callId: "c1", name: "Read", status: "complete" },
				{ callId: "c2", name: "Grep", status: "running" },
			],
		})
	);
	expect(scope.getByText(CURRENTLY_RE)).toBeDefined();
	expect(scope.getByText("Grep")).toBeDefined();
});

it("falls back to a Working… shimmer before any tool has been attributed", () => {
	const { scope } = renderCard(task({}));
	expect(scope.getByText("Working…")).toBeDefined();
});

it("counts completed tools in the header", () => {
	const { scope } = renderCard(
		task({
			toolRuns: [
				{ callId: "c1", name: "Read", status: "complete" },
				{ callId: "c2", name: "Read", status: "complete" },
				{ callId: "c3", name: "Grep", status: "running" },
			],
		})
	);
	expect(scope.getByText("2")).toBeDefined();
});

it("expands to the prompt and the tool history, marking errored runs", () => {
	const { scope } = renderCard(
		task({
			prompt: "Find every TODO in the repo",
			status: "complete",
			subagentType: "explore",
			toolRuns: [
				{ callId: "c1", name: "Grep", status: "complete" },
				{ callId: "c2", name: "Bash", status: "error" },
			],
		})
	);
	fireEvent.click(headerOf(scope));
	expect(scope.getByText("Prompt · explore")).toBeDefined();
	expect(scope.getByText("Find every TODO in the repo")).toBeDefined();
	expect(scope.getByText("Grep")).toBeDefined();
	const failedRun = scope.getByText("Bash");
	expect(failedRun.className).toContain("text-destructive");
});

it("clamps a long result and expands it on demand", () => {
	const longText = Array.from(
		{ length: 12 },
		(_, i) => `finding line ${i}`
	).join("\n");
	const { scope } = renderCard(
		task({ resultText: longText, status: "complete" })
	);
	fireEvent.click(headerOf(scope));
	const toggle = scope.getByText("Show full result");
	fireEvent.click(toggle);
	expect(scope.getByText("Show less")).toBeDefined();
});

it("auto-opens ONCE when the task fails after mount, then respects a collapse", () => {
	const running = task({});
	const { container, rerender } = render(<TaskCard task={running} />);
	const scope = within(container);
	rerender(<TaskCard task={task({ resultText: "boom", status: "error" })} />);
	// A late failure pops the panel open by itself…
	expect(scope.getByText("boom")).toBeDefined();
	// …but once the user collapses it, later re-renders leave it closed.
	fireEvent.click(headerOf(scope));
	expect(scope.queryByText("boom")).toBeNull();
	rerender(<TaskCard task={task({ resultText: "boom", status: "error" })} />);
	expect(scope.queryByText("boom")).toBeNull();
});

it("shows the run duration when the adapter measured one", () => {
	const { scope } = renderCard(task({ durationMs: 4200, status: "complete" }));
	expect(scope.getByText("4.2s")).toBeDefined();
});
