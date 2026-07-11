// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ActivityGroup } from "./activity-group";

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

it("shows a collapsed disclosure summarizing the group's size", () => {
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
