import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { ToolGroup } from "@better-agent/ui/components/chat/tool";
import {
	renderFromRegistry,
	type ToolRegistry,
} from "@better-agent/ui/components/chat/tool-registry";
import { cn } from "@better-agent/ui/lib/utils";
import { useState } from "react";
import { useClientPref } from "@/utils/preferences";
import { diffFor } from "./activity-diff";
import { ActivityDiffView } from "./activity-diff-view";
import {
	primaryLine,
	ToolCardHeader,
	type ToolCategory,
} from "./activity-item-header";
import { BashCommandCard } from "./bash-command-card";
import { isMcpToolName, McpToolCard } from "./mcp-tool-card";
import { ReportFindingsCard } from "./report-findings-card";
import { parseTodoItems, TodoList } from "./todo-list";
import { categoryOf } from "./tool-category";
import {
	computeErrorLine,
	computeOutput,
	computeRawParams,
	computeTail,
	ErrorPreviewLine,
	RawParamsSection,
	TailLine,
} from "./tool-output-preview";
import { asRecord, outputRecord } from "./tool-structured-output";
import { WebFetchCard } from "./web-fetch-card";
import { WebSearchCard } from "./web-search-card";

// R-refactor (Bug 3) / R1-T3: renders a LOCAL agent's real CLI tool
// executions — shell commands, file edits, reads, searches — as compact
// terminal-style ActivityItem cards, instead of the generic JSON `ToolGroup`
// fallback. An uncategorized tool returns null so the caller falls back to
// the default card. The web-agent chat doesn't use this. P1-T3: the command
// category routes to its own richer `BashCommandCard`; the output-shaping
// helpers both cards share live in activity-item-header.tsx.
//
// fix-tool-render-gaps: tool classification (`categoryOf`, the exact built-in
// name table, the mcp__ short-circuit) lives in tool-category.ts now, and the
// registry routes `mcp__*`/TodoWrite/WebFetch/WebSearch/ReportFindings to their
// dedicated cards ahead of the category entry — see `bridgeToolRegistry` below.

/** The disclosure body: the inline diff when one's known, else the plain
 * captured output — split out so `ActivityItem` doesn't nest ternaries. */
function ActivityBody({
	diffLines,
	output,
}: {
	diffLines: ReturnType<typeof diffFor>;
	output: string;
}) {
	if (diffLines) {
		return <ActivityDiffView lines={diffLines} />;
	}
	return (
		<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xs leading-relaxed">
			{output}
		</pre>
	);
}

/** `ActivityBody`, but only rendered once the panel is open AND there's
 * something to show — split out (rather than an inline `&&` chain) purely to
 * keep `ActivityItem`'s complexity under the repo's ESLint gate. */
function ActivityBodyIfOpen({
	hasBody,
	open,
	diffLines,
	output,
}: {
	hasBody: boolean;
	open: boolean;
	diffLines: ReturnType<typeof diffFor>;
	output: string;
}) {
	if (!(hasBody && open)) {
		return null;
	}
	return <ActivityBody diffLines={diffLines} output={output} />;
}

function computeDiffLines(
	category: ToolCategory,
	tool: ToolInvocation
): ReturnType<typeof diffFor> {
	if (category !== "fileEdit" || tool.status !== "complete") {
		return null;
	}
	return diffFor(tool);
}

/** ActivityItem: the rich card for a categorized tool call (fileEdit/
 * fileRead/search — a command renders `BashCommandCard` instead, see the
 * registry below). Exported directly for the turn spine renderer;
 * `bridgeToolRegistry` below wraps it for the shared `ChatRow` seam. */
export function ActivityItem({
	category,
	tool,
}: {
	category: ToolCategory;
	tool: ToolInvocation;
}) {
	const diffLines = computeDiffLines(category, tool);
	const output = computeOutput(tool);
	// P2-T4: the raw-input section counts as body too — with the pref on, a
	// card whose only detail is its input still gets a working disclosure.
	const rawParams = computeRawParams(tool, useClientPref("showRawParameters"));
	const hasOutputBody = diffLines !== null || output.length > 0;
	const hasBody = hasOutputBody || rawParams !== "";
	const [open, setOpen] = useState(tool.isError);
	const tail = computeTail(tool);
	const errorLine = computeErrorLine(tool, hasBody, open);
	return (
		<div
			className={cn(
				"overflow-hidden rounded-md bg-muted/40 text-xs",
				tool.isError && "bg-destructive/10"
			)}
		>
			<ToolCardHeader
				diffLines={diffLines}
				hasBody={hasBody}
				line={primaryLine(category, tool)}
				onToggle={() => setOpen((v) => !v)}
				open={open}
				tool={tool}
			/>
			<TailLine tail={tail} />
			<ErrorPreviewLine text={errorLine} />
			<RawParamsSection open={open} text={rawParams} />
			<ActivityBodyIfOpen
				diffLines={diffLines}
				hasBody={hasOutputBody}
				open={open}
				output={output}
			/>
		</div>
	);
}

/** TodoWrite's checklist, read from the tool INPUT (`todos`), falling back to
 * the structured OUTPUT (`newTodos`) if the input didn't survive. Empty →
 * `TodoList` renders null and the registry passes to the generic card. */
function renderTodoWrite(tool: ToolInvocation) {
	const fromInput = parseTodoItems(asRecord(tool.args)?.todos);
	const items =
		fromInput.length > 0
			? fromInput
			: parseTodoItems(outputRecord(tool)?.newTodos);
	return <TodoList items={items} />;
}

/** The local-agent terminal's tool-card registry (P1-T1): rich terminal
 * cards for shell/edit/read/search executions; an uncategorized tool is
 * unclaimed (null), so a `ChatRow`/`ToolGroup` given this registry falls
 * back to the default plain collapsible block. P1-T3: a command claims the
 * dedicated `BashCommandCard` ($-prefixed, inline output, late-output
 * auto-expand-once); the other categories keep `ActivityItem`.
 *
 * fix-tool-render-gaps: dedicated cards are registered AHEAD of the category
 * entry — an `mcp__*` call (unified MCP card), and Claude Code's TodoWrite
 * (checklist), WebFetch, WebSearch, and ReportFindings, all previously
 * misfiled or dumped as raw JSON. First match wins (see renderFromRegistry). */
export const bridgeToolRegistry: ToolRegistry = [
	{
		match: (tool) => isMcpToolName(tool.toolName),
		render: (tool) => <McpToolCard tool={tool} />,
	},
	{
		match: (tool) => tool.toolName === "TodoWrite",
		render: renderTodoWrite,
	},
	{
		match: (tool) => tool.toolName === "WebFetch",
		render: (tool) => <WebFetchCard tool={tool} />,
	},
	{
		match: (tool) => tool.toolName === "WebSearch",
		render: (tool) => <WebSearchCard tool={tool} />,
	},
	{
		match: (tool) => tool.toolName === "ReportFindings",
		render: (tool) => <ReportFindingsCard tool={tool} />,
	},
	{
		match: (tool) => categoryOf(tool.toolName) !== null,
		render: (tool) => {
			const category = categoryOf(tool.toolName);
			if (!category) {
				return null;
			}
			if (category === "command") {
				return <BashCommandCard tool={tool} />;
			}
			return <ActivityItem category={category} tool={tool} />;
		},
	},
];

/** The turn spine's direct renderer (assistant-turn-block.tsx / activity-
 * group.tsx): unlike the `ChatRow` seam, an uncategorized tool never falls
 * through to null — it renders `ToolGroup`'s plain collapsible block itself,
 * since there's no `ChatRow` seam left to fall back to. */
export function renderActivityTool(tool: ToolInvocation) {
	return (
		renderFromRegistry(bridgeToolRegistry, tool) ?? <ToolGroup tools={[tool]} />
	);
}
