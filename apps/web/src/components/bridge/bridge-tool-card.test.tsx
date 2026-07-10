// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { render, within } from "@testing-library/react";
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
