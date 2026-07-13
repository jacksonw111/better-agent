// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { renderFromRegistry } from "@better-agent/ui/components/chat/tool-registry";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { bridgeToolRegistry } from "./bridge-tool-card";

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

/** The `ChatRow`-seam dispatch: the bridge registry claims categorized
 * tools, and an uncategorized one comes back null (default card). */
function renderBridgeTool(t: ToolInvocation) {
	return renderFromRegistry(bridgeToolRegistry, t);
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

// Command-card behavior (error auto-expand, late-output expand-once, copy,
// line counts) is specified in bash-command-card.test.tsx — the registry
// routes the command category there now. The error contract of the OTHER
// categories' ActivityItem stays covered here via a search tool:

it("auto-expands an errored non-command call", () => {
	const scope = renderTool(
		tool({
			toolName: "Grep",
			args: { pattern: "TODO" },
			status: "error",
			isError: true,
			result: "ripgrep crashed",
		})
	);
	expect(scope.getByRole("button").getAttribute("aria-expanded")).toBe("true");
	expect(scope.getByText("ripgrep crashed")).toBeDefined();
});

it("keeps a persistent one-line error preview visible after collapsing an errored call (cloud parity)", () => {
	const scope = renderTool(
		tool({
			toolName: "Grep",
			args: { pattern: "TODO" },
			status: "error",
			isError: true,
			result: "ripgrep crashed",
		})
	);
	// Auto-expanded by default; collapse it and the error text must stay
	// visible via the persistent preview line rather than disappearing with
	// the body — matches cloud's PlainToolView, whose destructive error line
	// lives outside the collapsible panel entirely.
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByRole("button").getAttribute("aria-expanded")).toBe("false");
	expect(scope.getByText("ripgrep crashed")).toBeDefined();
});

it("routes the command category to the $-prefixed BashCommandCard", () => {
	const scope = renderTool(tool({ toolName: "Bash", args: { command: "ls" } }));
	expect(scope.getByText("$")).toBeDefined();
});
