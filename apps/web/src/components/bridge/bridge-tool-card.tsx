import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { ToolGroup } from "@better-agent/ui/components/chat/tool";
import {
	renderFromRegistry,
	type ToolRegistry,
} from "@better-agent/ui/components/chat/tool-registry";
import { cn } from "@better-agent/ui/lib/utils";
import { useState } from "react";
import { diffFor } from "./activity-diff";
import { ActivityDiffView } from "./activity-diff-view";
import {
	primaryLine,
	ToolCardHeader,
	type ToolCategory,
} from "./activity-item-header";
import { BashCommandCard } from "./bash-command-card";
import {
	computeErrorLine,
	computeOutput,
	computeTail,
	ErrorPreviewLine,
	TailLine,
} from "./tool-output-preview";

// R-refactor (Bug 3) / R1-T3: renders a LOCAL agent's real CLI tool
// executions — shell commands, file edits, reads, searches — as compact
// terminal-style ActivityItem cards, instead of the generic JSON `ToolGroup`
// fallback. An uncategorized tool returns null so the caller falls back to
// the default card. The web-agent chat doesn't use this. P1-T3: the command
// category routes to its own richer `BashCommandCard`; the output-shaping
// helpers both cards share live in activity-item-header.tsx.

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
	const hasBody = diffLines !== null || output.length > 0;
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
			<ActivityBodyIfOpen
				diffLines={diffLines}
				hasBody={hasBody}
				open={open}
				output={output}
			/>
		</div>
	);
}

/** The local-agent terminal's tool-card registry (P1-T1): rich terminal
 * cards for shell/edit/read/search executions; an uncategorized tool is
 * unclaimed (null), so a `ChatRow`/`ToolGroup` given this registry falls
 * back to the default plain collapsible block. P1-T3: a command claims the
 * dedicated `BashCommandCard` ($-prefixed, inline output, late-output
 * auto-expand-once); the other categories keep `ActivityItem`. */
export const bridgeToolRegistry: ToolRegistry = [
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
