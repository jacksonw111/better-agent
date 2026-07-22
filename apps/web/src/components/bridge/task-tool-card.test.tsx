// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { TaskToolCard } from "./task-tool-card";

const NEW_TASK_LABEL = /new task/i;
const IN_PROGRESS_LABEL = /in progress/i;
const TASK_UPDATE_LABEL = /task update/i;

function tool(
	partial: Partial<ToolInvocation> & { toolName: string }
): ToolInvocation {
	return {
		args: undefined,
		callId: "c1",
		isError: false,
		status: "complete",
		...partial,
	};
}

it("TaskCreate renders the subject as a clean task row, not the raw output", () => {
	const { container } = render(
		<TaskToolCard
			tool={tool({
				toolName: "TaskCreate",
				args: {
					subject: "Create dino-assets.ts (sprites + helpers)",
					description: "sprite atlas plus loader helpers",
				},
				result:
					"Task #9 created successfully: Create dino-assets.ts (sprites + helpers)",
			})}
		/>
	);
	const view = within(container);
	expect(
		view.getByText("Create dino-assets.ts (sprites + helpers)")
	).toBeDefined();
	expect(view.getByText("sprite atlas plus loader helpers")).toBeDefined();
	expect(view.getByText(NEW_TASK_LABEL)).toBeDefined();
	// The raw "created successfully" output must NOT be shown verbatim.
	expect(container.textContent).not.toContain("created successfully");
});

it("TaskCreate falls back to the subject parsed from output when input lacks it", () => {
	const { container } = render(
		<TaskToolCard
			tool={tool({
				toolName: "TaskCreate",
				args: {},
				result: "Task #12 created successfully: Wire up the score HUD",
			})}
		/>
	);
	expect(within(container).getByText("Wire up the score HUD")).toBeDefined();
});

it("TaskUpdate shows the status transition with a label", () => {
	const { container } = render(
		<TaskToolCard
			tool={tool({
				toolName: "TaskUpdate",
				args: {
					taskId: "9",
					status: "in_progress",
					subject: "Create dino-assets.ts",
				},
				result: "Task #9 updated",
			})}
		/>
	);
	const view = within(container);
	expect(view.getByText("Create dino-assets.ts")).toBeDefined();
	expect(view.getByText(IN_PROGRESS_LABEL)).toBeDefined();
	expect(view.getByText(TASK_UPDATE_LABEL)).toBeDefined();
});

it("TaskList renders a structured task list", () => {
	const { container } = render(
		<TaskToolCard
			tool={tool({
				toolName: "TaskList",
				args: {},
				result: [
					{ taskId: "1", subject: "Scaffold project", status: "completed" },
					{ taskId: "2", subject: "Add sprites", status: "in_progress" },
					{ taskId: "3", subject: "Ship it", status: "pending" },
				],
			})}
		/>
	);
	const view = within(container);
	expect(view.getByText("Scaffold project")).toBeDefined();
	expect(view.getByText("Add sprites")).toBeDefined();
	expect(view.getByText("Ship it")).toBeDefined();
});

it("TaskList falls back to clean text when the output is unstructured", () => {
	const { container } = render(
		<TaskToolCard
			tool={tool({
				toolName: "TaskList",
				args: {},
				result: "1. Do the thing\n2. Do the other thing",
			})}
		/>
	);
	expect(container.textContent).toContain("Do the thing");
});

it("degrades to a generic tool card when the shape is empty/unexpected", () => {
	const { container } = render(
		<TaskToolCard
			tool={tool({ toolName: "TaskCreate", args: {}, result: "" })}
		/>
	);
	// Still renders the tool name somewhere rather than crashing or blanking.
	expect(container.textContent).toContain("TaskCreate");
});

it("does not show a 0.0s duration for these instant tools", () => {
	const { container } = render(
		<TaskToolCard
			tool={tool({
				toolName: "TaskCreate",
				args: { subject: "Quick task" },
				result: "Task #1 created successfully: Quick task",
				durationMs: 0,
			})}
		/>
	);
	expect(container.textContent).not.toContain("0.0s");
});
