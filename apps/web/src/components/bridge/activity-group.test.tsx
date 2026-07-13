// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ActivityGroup } from "./activity-group";

const MORE_SUFFIX_RE = /more$/;

function tool(
	callId: string,
	partial: Partial<ToolInvocation> = {}
): ToolInvocation {
	return {
		args: { command: `step ${callId}` },
		callId,
		isError: false,
		status: "complete",
		toolName: "Bash",
		...partial,
	};
}

it("shows a collapsed disclosure summarizing a mixed group's size", () => {
	const tools = Array.from({ length: 6 }, (_, i) => tool(`c${i}`));
	const { container } = render(<ActivityGroup tools={tools} />);
	const scope = within(container);
	expect(scope.getByText("执行了 6 个操作")).toBeDefined();
	expect(scope.queryByText("step c0")).toBeNull();
});

it("expands to show every item on click", () => {
	const tools = Array.from({ length: 6 }, (_, i) => tool(`c${i}`));
	const { container } = render(<ActivityGroup tools={tools} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("step c0")).toBeDefined();
	expect(scope.getByText("step c5")).toBeDefined();
});

it("names a same-tool group with count and the first two previews", () => {
	const tools = Array.from({ length: 4 }, (_, i) => tool(`c${i}`));
	const { container } = render(<ActivityGroup toolName="Bash" tools={tools} />);
	const scope = within(container);
	expect(scope.getByText("Bash")).toBeDefined();
	expect(scope.getByText("×4")).toBeDefined();
	expect(scope.getByText("step c0 · step c1")).toBeDefined();
	expect(scope.getByText("+2 more")).toBeDefined();
});

it("omits the +N suffix when the group has no calls beyond the previews", () => {
	const tools = Array.from({ length: 2 }, (_, i) => tool(`c${i}`));
	const { container } = render(<ActivityGroup toolName="Bash" tools={tools} />);
	expect(within(container).queryByText(MORE_SUFFIX_RE)).toBeNull();
});

it("expands a same-tool group to individual activity items", () => {
	const tools = Array.from({ length: 3 }, (_, i) => tool(`c${i}`));
	const { container } = render(<ActivityGroup toolName="Bash" tools={tools} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("step c2")).toBeDefined();
});

it("falls back to the wire title as preview for an uncategorized tool", () => {
	const tools = Array.from({ length: 3 }, (_, i) =>
		tool(`c${i}`, { args: {}, title: `task ${i}`, toolName: "mcp__thing" })
	);
	const { container } = render(
		<ActivityGroup toolName="mcp__thing" tools={tools} />
	);
	expect(within(container).getByText("task 0 · task 1")).toBeDefined();
});
