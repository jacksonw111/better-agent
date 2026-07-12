import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { RenderTool } from "@better-agent/ui/components/chat/chat-row";
import { ToolGroup } from "@better-agent/ui/components/chat/tool";
import { cn } from "@better-agent/ui/lib/utils";
import { useState } from "react";
import { diffFor } from "./activity-diff";
import { ActivityDiffView } from "./activity-diff-view";
import {
	primaryLine,
	ToolCardHeader,
	type ToolCategory,
} from "./activity-item-header";
import { flattenToolResult } from "./tool-result-text";

// R-refactor (Bug 3) / R1-T3: renders a LOCAL agent's real CLI tool
// executions — shell commands, file edits, reads, searches — as compact
// terminal-style ActivityItem cards, instead of the generic JSON `ToolGroup`
// fallback. An uncategorized tool returns null so the caller falls back to
// the default card. The web-agent chat doesn't use this.

const OUTPUT_CHAR_CAP = 4000;

const COMMAND_RE = /bash|shell|\bsh\b|zsh|exec|command|\brun\b|terminal/;
const FILE_EDIT_RE = /edit|write|create|patch|replace/;
const FILE_READ_RE = /read|view|\bcat\b|open/;
const SEARCH_RE = /grep|glob|search|find|ripgrep/;

export function categoryOf(name: string): ToolCategory | null {
	const n = name.toLowerCase();
	if (COMMAND_RE.test(n)) {
		return "command";
	}
	if (FILE_EDIT_RE.test(n)) {
		return "fileEdit";
	}
	if (FILE_READ_RE.test(n)) {
		return "fileRead";
	}
	if (SEARCH_RE.test(n)) {
		return "search";
	}
	return null;
}

function cappedOutput(result: unknown): string {
	const text = flattenToolResult(result).trimEnd();
	return text.length > OUTPUT_CHAR_CAP
		? `${text.slice(0, OUTPUT_CHAR_CAP)}\n…(truncated)`
		: text;
}

/** The last non-blank line of a running call's live `preview` — shown as a
 * single-line muted tail under the header, terminal-style. REPLACE
 * semantics: `preview` already holds the latest snapshot (see
 * `bridge-events.ts`), so this just re-derives from whatever's current. */
function previewTail(preview: string | undefined): string {
	if (!preview) {
		return "";
	}
	const lines = preview.split("\n").filter((line) => line.trim() !== "");
	return lines.at(-1) ?? "";
}

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

/** ActivityItem: the rich card for a categorized tool call (command/
 * fileEdit/fileRead/search). Exported directly for the turn spine renderer;
 * `renderBridgeTool` below wraps it for the shared `ChatRow` seam. */
export function ActivityItem({
	category,
	tool,
}: {
	category: ToolCategory;
	tool: ToolInvocation;
}) {
	const diffLines =
		category === "fileEdit" && tool.status === "complete"
			? diffFor(tool)
			: null;
	const output = tool.status === "running" ? "" : cappedOutput(tool.result);
	const hasBody = diffLines !== null || output.length > 0;
	const [open, setOpen] = useState(tool.isError);
	const tail = tool.status === "running" ? previewTail(tool.preview) : "";
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
			{tail ? (
				<div className="truncate px-2 py-1 font-mono text-muted-foreground text-xs">
					{tail}
				</div>
			) : null}
			{hasBody && open ? (
				<ActivityBody diffLines={diffLines} output={output} />
			) : null}
		</div>
	);
}

/** ChatRow `renderTool` for the local-agent terminal: rich cards for shell/
 * edit/read/search executions; null (default card) for anything else. */
export const renderBridgeTool: RenderTool = (tool) => {
	const category = categoryOf(tool.toolName);
	if (!category) {
		return null;
	}
	return <ActivityItem category={category} tool={tool} />;
};

/** The turn spine's direct renderer (assistant-turn-block.tsx / activity-
 * group.tsx): unlike `renderBridgeTool`, an uncategorized tool never falls
 * through to null — it renders `ToolGroup`'s plain collapsible block itself,
 * since there's no `ChatRow` seam left to fall back to. */
export function renderActivityTool(tool: ToolInvocation) {
	const category = categoryOf(tool.toolName);
	if (!category) {
		return <ToolGroup tools={[tool]} />;
	}
	return <ActivityItem category={category} tool={tool} />;
}
