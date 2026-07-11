// @vitest-environment jsdom
import type {
	ChatBlock,
	ChatMessage,
	ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { AssistantTurnBlock } from "./assistant-turn-block";

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

function message(
	blocks: ChatBlock[],
	status: ChatMessage["status"] = "complete"
): ChatMessage {
	return { blocks, id: "m1", role: "assistant", status };
}

it("renders text and a single activity item hanging off a left-border spine", () => {
	const { container } = render(
		<AssistantTurnBlock
			message={message([
				{ kind: "text", text: "Let me check that." },
				{ kind: "tool", tool: tool("c1") },
			])}
		/>
	);
	const scope = within(container);
	expect(scope.getByText("Let me check that.")).toBeDefined();
	expect(scope.getByText("step c1")).toBeDefined();
	expect(container.querySelector(".border-l")).not.toBeNull();
});

it("collapses a run of more than 5 tool blocks into an ActivityGroup disclosure", () => {
	const blocks: ChatBlock[] = Array.from({ length: 6 }, (_, i) => ({
		kind: "tool" as const,
		tool: tool(`c${i}`),
	}));
	const { container } = render(
		<AssistantTurnBlock message={message(blocks)} />
	);
	const scope = within(container);
	expect(scope.getByText("执行了 6 个操作")).toBeDefined();
	expect(scope.queryByText("step c0")).toBeNull();
});

it("renders a reasoning block as a collapsible", () => {
	const { container } = render(
		<AssistantTurnBlock
			message={message([{ kind: "reasoning", text: "pondering" }])}
		/>
	);
	expect(within(container).getByText("Reasoning")).toBeDefined();
});
