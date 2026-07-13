import type {
	ChatBlock,
	ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";
import { expect, it } from "vitest";
import { groupTurnBlocks } from "./activity-blocks";

function tool(
	callId: string,
	toolName = "Bash",
	status: ToolInvocation["status"] = "complete"
): ToolInvocation {
	return { args: {}, callId, isError: false, status, toolName };
}

function toolBlock(
	callId: string,
	toolName = "Bash",
	status?: ToolInvocation["status"]
): ChatBlock {
	return { kind: "tool", tool: tool(callId, toolName, status) };
}

/** N consecutive completed calls to the same tool. */
function sameToolBlocks(count: number, toolName = "Bash"): ChatBlock[] {
	return Array.from({ length: count }, (_, i) =>
		toolBlock(`${toolName.toLowerCase()}${i}`, toolName)
	);
}

/** N consecutive completed calls alternating between two tools, so no
 * same-name segment ever reaches the named-group threshold. */
function mixedToolBlocks(count: number): ChatBlock[] {
	return Array.from({ length: count }, (_, i) =>
		toolBlock(`m${i}`, i % 2 === 0 ? "Read" : "Grep")
	);
}

it("keeps text and reasoning blocks as elements keyed by block index", () => {
	const blocks: ChatBlock[] = [
		{ kind: "text", text: "hello" },
		{ kind: "reasoning", text: "thinking" },
	];
	expect(groupTurnBlocks(blocks)).toEqual([
		{ key: "text-0", kind: "text", text: "hello" },
		{ key: "reasoning-1", kind: "reasoning", text: "thinking" },
	]);
});

it("emits nothing for a blank prose block", () => {
	const blocks: ChatBlock[] = [
		{ kind: "reasoning", text: "  \n" },
		{ kind: "text", text: "" },
	];
	expect(groupTurnBlocks(blocks)).toEqual([]);
});

it("leaves 2 consecutive same-tool calls ungrouped (below threshold)", () => {
	const elements = groupTurnBlocks(sameToolBlocks(2));
	expect(elements.map((e) => e.kind)).toEqual(["tool", "tool"]);
});

it("collapses 3 consecutive completed same-tool calls into a named group", () => {
	const elements = groupTurnBlocks(sameToolBlocks(3));
	expect(elements).toHaveLength(1);
	expect(elements[0]).toMatchObject({
		kind: "toolGroup",
		sameToolName: "Bash",
	});
	expect(
		elements[0].kind === "toolGroup" && elements[0].tools.map((t) => t.callId)
	).toEqual(["bash0", "bash1", "bash2"]);
});

it("keys a group by its first call, stable as the group grows", () => {
	const before = groupTurnBlocks(sameToolBlocks(3));
	const after = groupTurnBlocks(sameToolBlocks(4));
	expect(before[0].key).toBe("group-bash0");
	expect(after[0].key).toBe("group-bash0");
	expect(after[0].kind === "toolGroup" && after[0].tools).toHaveLength(4);
});

it("keys loose tools by callId so pre-group renders are addressable", () => {
	const elements = groupTurnBlocks(sameToolBlocks(2));
	expect(elements.map((e) => e.key)).toEqual(["tool-bash0", "tool-bash1"]);
});

it("never folds a running call, but still folds the completed calls before it", () => {
	const blocks: ChatBlock[] = [
		...sameToolBlocks(3),
		toolBlock("bash3", "Bash", "running"),
	];
	const elements = groupTurnBlocks(blocks);
	expect(elements.map((e) => e.kind)).toEqual(["toolGroup", "tool"]);
	expect(elements[0].key).toBe("group-bash0");
	expect(elements[1]).toMatchObject({ kind: "tool" });
});

it("counts only completed calls toward the named threshold", () => {
	const blocks: ChatBlock[] = [
		...sameToolBlocks(2),
		toolBlock("bash2", "Bash", "running"),
	];
	const elements = groupTurnBlocks(blocks);
	expect(elements.map((e) => e.kind)).toEqual(["tool", "tool", "tool"]);
});

it("folds a same-tool run across an interleaved BLANK reasoning block", () => {
	const blocks: ChatBlock[] = [
		toolBlock("bash0"),
		{ kind: "reasoning", text: "" },
		toolBlock("bash1"),
		toolBlock("bash2"),
	];
	const elements = groupTurnBlocks(blocks);
	expect(elements).toHaveLength(1);
	expect(elements[0]).toMatchObject({
		key: "group-bash0",
		kind: "toolGroup",
		sameToolName: "Bash",
	});
});

it("splits a run at a visible prose block", () => {
	const blocks: ChatBlock[] = [
		...sameToolBlocks(3),
		{ kind: "text", text: "an update" },
		...mixedToolBlocks(6),
	];
	const elements = groupTurnBlocks(blocks);
	expect(elements.map((e) => e.kind)).toEqual([
		"toolGroup",
		"text",
		"toolGroup",
	]);
	expect(elements[1].key).toBe("text-3");
});

it("leaves a mixed-name stretch of 5 or fewer ungrouped", () => {
	const elements = groupTurnBlocks(mixedToolBlocks(5));
	expect(elements.map((e) => e.kind)).toEqual(new Array(5).fill("tool"));
});

it("collapses a mixed-name stretch of more than 5 into the generic group", () => {
	const elements = groupTurnBlocks(mixedToolBlocks(6));
	expect(elements).toHaveLength(1);
	expect(elements[0]).toMatchObject({ key: "group-m0", kind: "toolGroup" });
	expect(
		elements[0].kind === "toolGroup" && elements[0].sameToolName
	).toBeUndefined();
});

it("keeps a folded mixed stretch folded while the NEXT call runs", () => {
	const blocks: ChatBlock[] = [
		...mixedToolBlocks(6),
		toolBlock("w0", "WebFetch", "running"),
	];
	const elements = groupTurnBlocks(blocks);
	expect(elements.map((e) => e.kind)).toEqual(["toolGroup", "tool"]);
	expect(elements[0].key).toBe("group-m0");
});

it("forms a named group first, then the mixed fallback on the remainder", () => {
	const blocks: ChatBlock[] = [...sameToolBlocks(3), ...mixedToolBlocks(6)];
	const elements = groupTurnBlocks(blocks);
	expect(elements.map((e) => e.kind)).toEqual(["toolGroup", "toolGroup"]);
	expect(elements[0]).toMatchObject({ sameToolName: "Bash" });
	expect(
		elements[1].kind === "toolGroup" && elements[1].sameToolName
	).toBeUndefined();
});

it("preserves order and full tool objects inside a group", () => {
	const elements = groupTurnBlocks(sameToolBlocks(6));
	const group = elements[0];
	expect(
		group.kind === "toolGroup" && group.tools.map((t) => t.callId)
	).toEqual(["bash0", "bash1", "bash2", "bash3", "bash4", "bash5"]);
});
