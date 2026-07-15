// @vitest-environment jsdom
import type {
	ChatBlock,
	ChatMessage,
	ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";
import { fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AssistantTurnBlock } from "./assistant-turn-block";

afterEach(() => {
	window.localStorage.clear();
});

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

function toolBlocks(count: number): ChatBlock[] {
	return Array.from({ length: count }, (_, i) => ({
		kind: "tool" as const,
		tool: tool(`c${i}`),
	}));
}

function message(
	blocks: ChatBlock[],
	status: ChatMessage["status"] = "complete"
): ChatMessage {
	return { blocks, id: "m1", role: "assistant", status };
}

// AssistantTurnBlock threads answer handlers down for embedded approval/
// question blocks; these tests cover text/tool/reasoning, so stub them.
const handlerStubs = {
	answered: {} as Record<string, string>,
	answeredQuestions: {} as Record<string, string[][]>,
	onAnswerApproval: () => {
		// test stub
	},
	onAnswerQuestion: () => {
		// test stub
	},
};

it("renders text and a single activity item hanging off a left-border spine", () => {
	const { container } = render(
		<AssistantTurnBlock
			{...handlerStubs}
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

it("collapses 3+ same-tool blocks into a named ActivityGroup disclosure", () => {
	const { container } = render(
		<AssistantTurnBlock {...handlerStubs} message={message(toolBlocks(4))} />
	);
	const scope = within(container);
	expect(scope.getByText("Bash")).toBeDefined();
	expect(scope.getByText("×4")).toBeDefined();
	expect(scope.queryByText("step c0")).toBeNull();
});

it("collapses a long mixed-name run into the generic count disclosure", () => {
	const blocks: ChatBlock[] = Array.from({ length: 6 }, (_, i) => ({
		kind: "tool" as const,
		tool: tool(`c${i}`, {
			args: { pattern: `find ${i}` },
			toolName: i % 2 === 0 ? "Grep" : "WebFetch",
		}),
	}));
	const { container } = render(
		<AssistantTurnBlock {...handlerStubs} message={message(blocks)} />
	);
	expect(within(container).getByText("执行了 6 个操作")).toBeDefined();
});

it("keeps a manually expanded group open when a new call joins it", () => {
	const { container, rerender } = render(
		<AssistantTurnBlock
			{...handlerStubs}
			message={message(toolBlocks(3), "streaming")}
		/>
	);
	const scope = within(container);
	fireEvent.click(scope.getByText("×3"));
	expect(scope.getByText("step c0")).toBeDefined();
	rerender(
		<AssistantTurnBlock
			{...handlerStubs}
			message={message(toolBlocks(4), "streaming")}
		/>
	);
	expect(scope.getByText("step c0")).toBeDefined();
	expect(scope.getByText("step c3")).toBeDefined();
});

it("renders a reasoning block as a collapsible", () => {
	const { container } = render(
		<AssistantTurnBlock
			{...handlerStubs}
			message={message([{ kind: "reasoning", text: "pondering" }])}
		/>
	);
	expect(within(container).getByText("Reasoning")).toBeDefined();
});

// P2-T4: the showThinking pref gates the reasoning TEXT blocks in this local
// feed — text/tool blocks are untouched.
it("hides reasoning blocks when the showThinking pref is off", () => {
	window.localStorage.setItem("ba:pref:showThinking", "false");
	const { container } = render(
		<AssistantTurnBlock
			{...handlerStubs}
			message={message([
				{ kind: "reasoning", text: "pondering" },
				{ kind: "text", text: "the answer" },
			])}
		/>
	);
	const scope = within(container);
	expect(scope.queryByText("Reasoning")).toBeNull();
	expect(scope.getByText("the answer")).toBeDefined();
});
