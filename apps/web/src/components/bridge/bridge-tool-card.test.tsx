// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderBridgeTool } from "./bridge-tool-card";

function tool(partial: Partial<ToolInvocation>): ToolInvocation {
	return {
		callId: "c1",
		toolName: "Bash",
		args: {},
		isError: false,
		status: "complete",
		...partial,
	};
}

function renderTool(t: ToolInvocation) {
	const node = renderBridgeTool(t);
	const { container } = render(<div>{node}</div>);
	return within(container);
}

it("renders a codex shell command (bare-string input) as a terminal card", () => {
	const scope = renderTool(
		tool({ toolName: "shell", args: "npm test", result: "ok" })
	);
	expect(scope.getByText("npm test")).toBeDefined();
});

it("renders a claude Bash command from the {command} input", () => {
	const scope = renderTool(
		tool({ toolName: "Bash", args: { command: "ls -la" } })
	);
	expect(scope.getByText("ls -la")).toBeDefined();
});

it("renders an Edit tool as its file path with an Edit label", () => {
	const scope = renderTool(
		tool({ toolName: "Edit", args: { file_path: "src/a.ts" } })
	);
	expect(scope.getByText("src/a.ts")).toBeDefined();
	expect(scope.getByText("Edit")).toBeDefined();
});

it("renders a Read tool as a file chip", () => {
	const scope = renderTool(
		tool({ toolName: "Read", args: { file_path: "src/b.ts" } })
	);
	expect(scope.getByText("src/b.ts")).toBeDefined();
	expect(scope.getByText("Read")).toBeDefined();
});

it("renders a Grep tool as its pattern with a Search label", () => {
	const scope = renderTool(
		tool({ toolName: "Grep", args: { pattern: "TODO" } })
	);
	expect(scope.getByText("TODO")).toBeDefined();
	expect(scope.getByText("Search")).toBeDefined();
});

it("returns null (default card) for an uncategorized tool", () => {
	expect(renderBridgeTool(tool({ toolName: "SomeMcpTool" }))).toBeNull();
});

it("shows no output body while a command is still running", () => {
	const scope = renderTool(
		tool({ toolName: "shell", args: "sleep 1", status: "running" })
	);
	// The disclosure toggle is disabled when there's no body to reveal.
	expect(scope.getByRole("button").hasAttribute("disabled")).toBe(true);
});

it("keeps the output collapsible when a completed command has output", () => {
	const scope = renderTool(
		tool({ toolName: "shell", args: "echo hi", result: "hi" })
	);
	expect(scope.getByRole("button").hasAttribute("disabled")).toBe(false);
});

it("shows a completed call's duration right-aligned on the header", () => {
	const scope = renderTool(
		tool({ toolName: "shell", args: "echo hi", durationMs: 3100 })
	);
	expect(scope.getByText("3.1s")).toBeDefined();
});

it("shows a sub-second duration with a leading zero", () => {
	const scope = renderTool(
		tool({ toolName: "shell", args: "ls", durationMs: 400 })
	);
	expect(scope.getByText("0.4s")).toBeDefined();
});

it("shows the last line of a running command's live preview as a tail", () => {
	const scope = renderTool(
		tool({
			toolName: "shell",
			args: "npm run build",
			status: "running",
			preview: "compiling…\ndone: src/a.ts\n",
		})
	);
	expect(scope.getByText("done: src/a.ts")).toBeDefined();
});

it("live-replaces the preview tail rather than appending across renders", () => {
	const running = tool({
		toolName: "shell",
		args: "npm run build",
		status: "running",
		preview: "first line",
	});
	const { rerender, container } = render(
		<div>{renderBridgeTool(running)}</div>
	);
	expect(within(container).getByText("first line")).toBeDefined();
	rerender(
		<div>{renderBridgeTool({ ...running, preview: "second line" })}</div>
	);
	const scope = within(container);
	expect(scope.getByText("second line")).toBeDefined();
	expect(scope.queryByText("first line")).toBeNull();
});

it("renders an inline diff and +/- counts for a completed Edit call", () => {
	const scope = renderTool(
		tool({
			toolName: "Edit",
			args: {
				file_path: "src/a.ts",
				old_string: "const a = 1;",
				new_string: "const a = 2;",
			},
		})
	);
	// The header shows the diff counts even before expanding.
	expect(scope.getByText("+1")).toBeDefined();
	expect(scope.getByText("-1")).toBeDefined();
	// Expand the disclosure to reveal the colored diff lines.
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("-const a = 1;")).toBeDefined();
	expect(scope.getByText("+const a = 2;")).toBeDefined();
});

it("falls back to the raw output view for a completed Edit call with no diff info", () => {
	const scope = renderTool(
		tool({ toolName: "Edit", args: { file_path: "src/a.ts" }, result: "ok" })
	);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("ok")).toBeDefined();
});

it("auto-expands an errored call", () => {
	const scope = renderTool(
		tool({
			toolName: "shell",
			args: "false",
			status: "error",
			isError: true,
			result: "exit code 1",
		})
	);
	expect(scope.getByRole("button").getAttribute("aria-expanded")).toBe("true");
	expect(scope.getByText("exit code 1")).toBeDefined();
});
