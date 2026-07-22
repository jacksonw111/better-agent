// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { renderFromRegistry } from "@better-agent/ui/components/chat/tool-registry";
import { fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { bridgeToolRegistry } from "./bridge-tool-card";
import { categoryOf } from "./tool-category";

// fix-tool-render-gaps: the precise `categoryOf` classification and the four
// dedicated cards (MCP / TodoWrite / WebFetch / WebSearch / ReportFindings).
// The six-piece/Task/approval regression coverage stays in
// bridge-tool-card.test.tsx — split so each file stays under the 300-line cap.

afterEach(() => {
	window.localStorage.clear();
});

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
	const node = renderFromRegistry(bridgeToolRegistry, t);
	const { container } = render(<div>{node}</div>);
	return within(container);
}

it.each([
	["Bash", "command"],
	["BashOutput", "command"],
	["KillShell", "command"],
	["SlashCommand", "command"],
	["Read", "fileRead"],
	["Edit", "fileEdit"],
	["Write", "fileEdit"],
	["NotebookEdit", "fileEdit"],
	["Glob", "search"],
	["Grep", "search"],
] as const)("maps the built-in %s to the %s category", (name, category) => {
	expect(categoryOf(name)).toBe(category);
});

it.each([
	"TodoWrite",
	"WebFetch",
	"WebSearch",
	"ReportFindings",
	"CronCreate",
	"ReadMcpResource",
	"Task",
])("no longer misclassifies the built-in %s (was a false positive)", (name) => {
	expect(categoryOf(name)).toBeNull();
});

it("keeps NotebookEdit classified as a fileEdit (exact, not substring)", () => {
	expect(categoryOf("NotebookEdit")).toBe("fileEdit");
});

it("short-circuits an mcp__ tool name to no built-in category", () => {
	expect(categoryOf("mcp__gmail__search_threads")).toBeNull();
	expect(categoryOf("mcp__google_calendar__create_event")).toBeNull();
});

it("keeps the substring heuristics for other CLIs' dynamic tool names", () => {
	expect(categoryOf("shell")).toBe("command");
	expect(categoryOf("edit")).toBe("fileEdit");
	expect(categoryOf("read")).toBe("fileRead");
	expect(categoryOf("ripgrep")).toBe("search");
});

it("renders an mcp__ call as the unified MCP card (server · tool)", () => {
	const scope = renderTool(
		tool({
			toolName: "mcp__gmail__search_threads",
			args: { query: "from:boss" },
			result: "3 threads",
		})
	);
	expect(scope.getByText("MCP")).toBeDefined();
	expect(scope.getByText("gmail")).toBeDefined();
	expect(scope.getByText("search_threads")).toBeDefined();
});

it("routes TodoWrite to the checklist instead of an empty Edit card", () => {
	const scope = renderTool(
		tool({
			toolName: "TodoWrite",
			args: {
				todos: [
					{ content: "Write the parser", status: "in_progress" },
					{ content: "Ship it", status: "pending" },
				],
			},
		})
	);
	expect(scope.getByText("Write the parser")).toBeDefined();
	expect(scope.getByText("Ship it")).toBeDefined();
	// The old bug drew an "Edit" label with an empty path; it must be gone.
	expect(scope.queryByText("Edit")).toBeNull();
});

it("renders a WebFetch call as a clickable host + processed result", () => {
	const scope = renderTool(
		tool({
			toolName: "WebFetch",
			args: { url: "https://example.com/page", prompt: "Summarize it" },
			result: JSON.stringify({
				url: "https://example.com/page",
				code: 200,
				codeText: "OK",
				result: "The page explains widgets.",
			}),
		})
	);
	const link = scope.getByRole("link", { name: "example.com" });
	expect(link.getAttribute("href")).toBe("https://example.com/page");
	expect(link.getAttribute("rel")).toContain("noopener");
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("The page explains widgets.")).toBeDefined();
	expect(scope.getByText("Summarize it")).toBeDefined();
});

it("renders a WebSearch call's query and its source list", () => {
	const scope = renderTool(
		tool({
			toolName: "WebSearch",
			args: { query: "cat facts" },
			result: JSON.stringify({
				query: "cat facts",
				results: [
					{
						tool_use_id: "t1",
						content: [
							{ title: "Cat Facts", url: "https://cats.example.com/facts" },
						],
					},
				],
				searchCount: 1,
			}),
		})
	);
	expect(scope.getByText("cat facts")).toBeDefined();
	fireEvent.click(scope.getByRole("button"));
	const link = scope.getByRole("link", { name: "Cat Facts" });
	expect(link.getAttribute("href")).toBe("https://cats.example.com/facts");
	expect(link.getAttribute("rel")).toContain("noopener");
});

it("renders a ReportFindings call as a findings list, not an empty Search card", () => {
	const scope = renderTool(
		tool({
			toolName: "ReportFindings",
			args: {
				findings: [
					{
						file: "src/a.ts",
						line: 12,
						summary: "Off-by-one in the loop bound",
						failure_scenario: "n=0 reads past the end",
						verdict: "CONFIRMED",
					},
				],
			},
		})
	);
	expect(scope.getByText("1 finding")).toBeDefined();
	expect(scope.getByText("src/a.ts:12")).toBeDefined();
	expect(scope.getByText("Off-by-one in the loop bound")).toBeDefined();
	expect(scope.getByText("CONFIRMED")).toBeDefined();
	expect(scope.queryByText("Search")).toBeNull();
});
