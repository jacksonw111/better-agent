import type {
	ChatBlock,
	ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";

// R1-T3 / P1-T2: maps one assistant turn's ordered `ChatBlock[]` into the
// elements its spine actually renders. Prose (text/reasoning) passes through
// unchanged; consecutive tool calls fold two ways:
//   1. >= SAME_TOOL_GROUP_THRESHOLD consecutive COMPLETED calls to the same
//      tool collapse into a named group ("Bash ×N" + previews).
//   2. Whatever's left over between named groups — a mixed-name stretch of
//      MORE than MIXED_GROUP_THRESHOLD completed calls — collapses into the
//      generic "执行了 N 个操作" group (the pre-P1-T2 fallback).
// Every element carries a stable `key` (callId-based for tools/groups,
// block-index-based for prose) so React identity survives the streaming
// moment when loose items merge into a group.

export type TurnElement =
	| { key: string; kind: "text"; text: string }
	| { key: string; kind: "reasoning"; text: string }
	| { key: string; kind: "tool"; tool: ToolInvocation }
	| {
			key: string;
			kind: "toolGroup";
			/** Set when every call in the group hit the SAME tool — the group
			 * header then names the tool ("Bash ×4") instead of the generic
			 * count line. */
			sameToolName?: string;
			tools: ToolInvocation[];
	  };

/** A leftover mixed-name stretch LONGER than this collapses into the generic
 * count group — matches the design spec's ">5 折叠"
 * (docs/local-agent-refactor-plan.md). */
const MIXED_GROUP_THRESHOLD = 5;

/** This many (or more) consecutive completed calls to the SAME tool collapse
 * into a named group. 3, not 2: the collapsed header already previews two
 * calls, so folding a 2-run would hide nothing while still costing a click. */
export const SAME_TOOL_GROUP_THRESHOLD = 3;

/** A prose block whose text is still blank renders nothing (its Response/
 * Reasoning would be an empty shell), so it neither emits an element nor
 * breaks a tool run's continuity — e.g. a reasoning block interleaved
 * mid-run whose first delta hasn't arrived yet. */
function isBlankProse(block: ChatBlock): boolean {
	return (
		(block.kind === "text" || block.kind === "reasoning") &&
		block.text.trim() === ""
	);
}

/** `block` is keyed by its index in the turn's block list — blocks are
 * append-only and never reorder, so the index is stable for the turn's
 * lifetime (unlike an index into the DERIVED element list, which shifts when
 * tools fold into a group). */
function proseElement(
	block: ChatBlock,
	blockIndex: number
): TurnElement | null {
	if (block.kind === "text") {
		return { key: `text-${blockIndex}`, kind: "text", text: block.text };
	}
	if (block.kind === "reasoning") {
		return {
			key: `reasoning-${blockIndex}`,
			kind: "reasoning",
			text: block.text,
		};
	}
	// `file` blocks belong to user turns only (see chat-blocks.ts) — never
	// appear in an assistant turn's block list, so there's nothing to render.
	return null;
}

function toolElement(tool: ToolInvocation): TurnElement {
	return { key: `tool-${tool.callId}`, kind: "tool", tool };
}

/** Keyed by the FIRST member's callId: appending later calls to the group
 * (streaming) never changes the key, so the group component — and the user's
 * manual expand — survives growth. */
function groupElement(
	tools: ToolInvocation[],
	sameToolName?: string
): TurnElement {
	return {
		key: `group-${tools[0]?.callId}`,
		kind: "toolGroup",
		sameToolName,
		tools,
	};
}

/** Collects the run of consecutive `tool` blocks starting at `start`. Blank
 * prose blocks inside the run are skipped (they render nothing, so they
 * don't break the run's visual continuity); the run's `end` sits just past
 * the last block it consumed. */
function collectToolRun(
	blocks: ChatBlock[],
	start: number
): { end: number; tools: ToolInvocation[] } {
	const tools: ToolInvocation[] = [];
	let end = start;
	while (end < blocks.length) {
		const block = blocks[end];
		if (block.kind === "tool") {
			tools.push(block.tool);
			end++;
			continue;
		}
		if (isBlankProse(block)) {
			end++;
			continue;
		}
		break;
	}
	return { end, tools };
}

/** The maximal run of consecutive COMPLETED calls to the same tool starting
 * at `start`. A running call ends the segment — it must stay individually
 * legible, so it can never be pulled into a group. */
function sameNameSegment(
	tools: ToolInvocation[],
	start: number
): ToolInvocation[] {
	const name = tools[start].toolName;
	const segment: ToolInvocation[] = [];
	let index = start;
	while (index < tools.length) {
		const tool = tools[index];
		if (tool.toolName !== name || tool.status === "running") {
			break;
		}
		segment.push(tool);
		index++;
	}
	return segment;
}

/** The mixed-name fallback for tools no named group claimed: a stretch of
 * MORE than `MIXED_GROUP_THRESHOLD` completed calls folds into the generic
 * count group, anything shorter renders individually. */
function stretchElements(stretch: ToolInvocation[]): TurnElement[] {
	if (stretch.length > MIXED_GROUP_THRESHOLD) {
		return [groupElement(stretch)];
	}
	return stretch.map(toolElement);
}

/**
 * Folds one run of consecutive tool calls. Named (same-tool) groups form
 * first; leftover completed calls accumulate into stretches that fold by the
 * mixed threshold. A RUNNING call always renders individually — and, unlike
 * the pre-P1-T2 logic, it does NOT keep the completed calls before it from
 * folding: folding must be monotonic within a streaming turn (groups only
 * ever grow, never dissolve back into loose items), or a group the user
 * expanded would be torn down every time the agent starts its next call. The
 * in-progress work itself stays fully legible — it's the one item that can
 * never be inside a group.
 */
function groupRun(tools: ToolInvocation[]): TurnElement[] {
	const elements: TurnElement[] = [];
	let stretch: ToolInvocation[] = [];
	const flushStretch = () => {
		elements.push(...stretchElements(stretch));
		stretch = [];
	};
	let index = 0;
	while (index < tools.length) {
		const tool = tools[index];
		if (tool.status === "running") {
			flushStretch();
			elements.push(toolElement(tool));
			index++;
			continue;
		}
		const segment = sameNameSegment(tools, index);
		if (segment.length >= SAME_TOOL_GROUP_THRESHOLD) {
			flushStretch();
			elements.push(groupElement(segment, segment[0].toolName));
		} else {
			stretch.push(...segment);
		}
		index += segment.length;
	}
	flushStretch();
	return elements;
}

/** Groups a turn's blocks for the spine renderer — see the header comment
 * for the folding rules and `groupRun` for the running-call semantics. */
export function groupTurnBlocks(blocks: ChatBlock[]): TurnElement[] {
	const elements: TurnElement[] = [];
	let index = 0;
	while (index < blocks.length) {
		const block = blocks[index];
		if (block.kind !== "tool") {
			const element = isBlankProse(block) ? null : proseElement(block, index);
			if (element) {
				elements.push(element);
			}
			index++;
			continue;
		}
		const { end, tools } = collectToolRun(blocks, index);
		elements.push(...groupRun(tools));
		index = end;
	}
	return elements;
}
