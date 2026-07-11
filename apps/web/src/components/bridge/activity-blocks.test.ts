import type {
	ChatBlock,
	ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";
import { expect, it } from "vitest";
import { groupTurnBlocks } from "./activity-blocks";

function tool(
	callId: string,
	status: ToolInvocation["status"] = "complete"
): ToolInvocation {
	return { args: {}, callId, isError: false, status, toolName: "Bash" };
}

function toolBlock(
	callId: string,
	status?: ToolInvocation["status"]
): ChatBlock {
	return { kind: "tool", tool: tool(callId, status) };
}

it("keeps text and reasoning blocks as individual elements", () => {
	const blocks: ChatBlock[] = [
		{ kind: "text", text: "hello" },
		{ kind: "reasoning", text: "thinking" },
	];
	expect(groupTurnBlocks(blocks)).toEqual([
		{ kind: "text", text: "hello" },
		{ kind: "reasoning", text: "thinking" },
	]);
});

it("leaves a run of 5 or fewer consecutive tool blocks ungrouped", () => {
	const blocks: ChatBlock[] = Array.from({ length: 5 }, (_, i) =>
		toolBlock(`c${i}`)
	);
	const elements = groupTurnBlocks(blocks);
	expect(elements).toHaveLength(5);
	for (const element of elements) {
		expect(element.kind).toBe("tool");
	}
});

it("collapses a run of more than 5 consecutive COMPLETE tool blocks into one group", () => {
	const blocks: ChatBlock[] = Array.from({ length: 6 }, (_, i) =>
		toolBlock(`c${i}`)
	);
	const elements = groupTurnBlocks(blocks);
	expect(elements).toHaveLength(1);
	expect(elements[0]).toMatchObject({ kind: "toolGroup" });
	expect(elements[0].kind === "toolGroup" && elements[0].tools).toHaveLength(6);
});

it("keeps a long run ungrouped while its LAST tool is still running", () => {
	const blocks: ChatBlock[] = [
		...Array.from({ length: 5 }, (_, i) => toolBlock(`c${i}`)),
		toolBlock("c5", "running"),
	];
	const elements = groupTurnBlocks(blocks);
	expect(elements).toHaveLength(6);
	for (const element of elements) {
		expect(element.kind).toBe("tool");
	}
});

it("splits grouping at a non-tool block in the middle of a long run", () => {
	const blocks: ChatBlock[] = [
		...Array.from({ length: 6 }, (_, i) => toolBlock(`a${i}`)),
		{ kind: "text", text: "an update" },
		...Array.from({ length: 6 }, (_, i) => toolBlock(`b${i}`)),
	];
	const elements = groupTurnBlocks(blocks);
	expect(elements.map((e) => e.kind)).toEqual([
		"toolGroup",
		"text",
		"toolGroup",
	]);
});

it("preserves order and full tool objects inside a group", () => {
	const blocks: ChatBlock[] = Array.from({ length: 6 }, (_, i) =>
		toolBlock(`c${i}`)
	);
	const elements = groupTurnBlocks(blocks);
	const group = elements[0];
	expect(
		group.kind === "toolGroup" && group.tools.map((t) => t.callId)
	).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
});
