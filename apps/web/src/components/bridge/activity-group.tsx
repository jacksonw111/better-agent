import { Collapsible } from "@base-ui/react/collapsible";
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { ChevronRightIcon } from "lucide-react";
import { primaryLine } from "./activity-item-header";
import { categoryOf, renderActivityTool } from "./bridge-tool-card";

// R1-T3 / P1-T2: the collapsed disclosure row a folded tool run renders as
// (see activity-blocks.ts's `groupTurnBlocks`). Two headers share it: a
// same-tool group names the tool ("Bash ×4") with the first calls' primary
// lines as a preview; the mixed-name fallback keeps the generic count line.
// Expanding shows every call as its usual ActivityItem. Only complete runs
// reach here — a still-running call stays individual upstream.

/** How many member calls the collapsed same-tool header previews. */
const PREVIEW_COUNT = 2;

/** The one-line preview for a member call: its ActivityItem primary text
 * (command/path/query) when the tool is categorized, else its wire title. */
function previewText(tool: ToolInvocation): string {
	const category = categoryOf(tool.toolName);
	if (category) {
		return primaryLine(category, tool).text;
	}
	return tool.title ?? "";
}

/** Collapsed header for a same-tool group: category icon + tool name + ×N +
 * the first calls' primary lines + "+N more". */
function SameToolSummary({
	toolName,
	tools,
}: {
	toolName: string;
	tools: ToolInvocation[];
}) {
	const category = categoryOf(toolName);
	const first = tools[0];
	const previews = tools
		.slice(0, PREVIEW_COUNT)
		.map(previewText)
		.filter((text) => text !== "");
	const hiddenCount = tools.length - PREVIEW_COUNT;
	return (
		<>
			{category && first ? primaryLine(category, first).icon : null}
			<span className="shrink-0 font-medium">{toolName}</span>
			<span className="shrink-0 tabular-nums">×{tools.length}</span>
			{previews.length > 0 ? (
				<span className="min-w-0 truncate font-mono">
					{previews.join(" · ")}
				</span>
			) : null}
			{hiddenCount > 0 ? (
				<span className="shrink-0">+{hiddenCount} more</span>
			) : null}
		</>
	);
}

export function ActivityGroup({
	toolName,
	tools,
}: {
	/** Set when every call in the group hit the same tool (`sameToolName` on
	 * the element) — switches the header to the named "×N + previews" form. */
	toolName?: string;
	tools: ToolInvocation[];
}) {
	return (
		<Collapsible.Root className="flex flex-col gap-1.5">
			<Collapsible.Trigger className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted-foreground text-xs hover:text-foreground">
				<ChevronRightIcon className="size-3.5 shrink-0 transition-transform data-[panel-open]:rotate-90" />
				{toolName ? (
					<SameToolSummary toolName={toolName} tools={tools} />
				) : (
					<span>执行了 {tools.length} 个操作</span>
				)}
			</Collapsible.Trigger>
			<Collapsible.Panel className="flex flex-col gap-1.5">
				{tools.map((tool) => (
					<div key={tool.callId}>{renderActivityTool(tool)}</div>
				))}
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
