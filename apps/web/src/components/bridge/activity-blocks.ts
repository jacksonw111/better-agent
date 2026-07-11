import type {
	ChatBlock,
	ToolInvocation,
} from "@better-agent/ui/components/chat/chat-blocks";

// R1-T3: maps one assistant turn's ordered `ChatBlock[]` into the elements
// its spine actually renders — text/reasoning pass through unchanged, but a
// long consecutive run of tool blocks collapses into one `toolGroup`
// disclosure (ActivityGroup) instead of a wall of individual ActivityItems.

export type TurnElement =
	| { kind: "text"; text: string }
	| { kind: "reasoning"; text: string }
	| { kind: "tool"; tool: ToolInvocation }
	| { kind: "toolGroup"; tools: ToolInvocation[] };

/** A run longer than this many consecutive tool blocks collapses into a
 * group — matches the design spec's ">5 折叠" (docs/local-agent-refactor-plan.md). */
const GROUP_THRESHOLD = 5;

function nonToolElement(block: ChatBlock): TurnElement | null {
	if (block.kind === "text") {
		return { kind: "text", text: block.text };
	}
	if (block.kind === "reasoning") {
		return { kind: "reasoning", text: block.text };
	}
	// `file` blocks belong to user turns only (see chat-blocks.ts) — never
	// appear in an assistant turn's block list, so there's nothing to render.
	return null;
}

/** Collects the run of consecutive `tool` blocks starting at `start`,
 * returning the run's `ToolInvocation`s and the index just past it. */
function collectToolRun(
	blocks: ChatBlock[],
	start: number
): { end: number; tools: ToolInvocation[] } {
	const tools: ToolInvocation[] = [];
	let end = start;
	while (end < blocks.length) {
		const block = blocks[end];
		if (block.kind !== "tool") {
			break;
		}
		tools.push(block.tool);
		end++;
	}
	return { end, tools };
}

/**
 * Groups a turn's blocks for the spine renderer. A run of MORE than
 * `GROUP_THRESHOLD` consecutive tool blocks collapses into a single
 * `toolGroup` element — but only once the run is COMPLETE: while the run's
 * last tool is still `running`, every item in it renders individually (an
 * in-progress run must stay legible, not hide behind a disclosure the user
 * would have to keep re-opening).
 */
export function groupTurnBlocks(blocks: ChatBlock[]): TurnElement[] {
	const elements: TurnElement[] = [];
	let index = 0;
	while (index < blocks.length) {
		const block = blocks[index];
		if (block.kind !== "tool") {
			const element = nonToolElement(block);
			if (element) {
				elements.push(element);
			}
			index++;
			continue;
		}
		const { end, tools } = collectToolRun(blocks, index);
		const lastRunning = tools.at(-1)?.status === "running";
		if (tools.length > GROUP_THRESHOLD && !lastRunning) {
			elements.push({ kind: "toolGroup", tools });
		} else {
			for (const tool of tools) {
				elements.push({ kind: "tool", tool });
			}
		}
		index = end;
	}
	return elements;
}
