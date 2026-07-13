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

/** A persistent one-line error preview, CSS-truncated to one line — parity
 * with cloud's `PlainToolView` (packages/ui/chat/tool.tsx), which shows its
 * destructive error line outside the collapsible panel so a failure stays
 * visible even collapsed. Grabs the FIRST non-blank line, since that's
 * usually where the actual error message lives — mirrors `previewTail`'s
 * "grab one line, let CSS `truncate` do the rest" shape, but from the front
 * of the text instead of the tail. */
function errorPreviewLine(result: unknown): string {
	const lines = cappedOutput(result)
		.split("\n")
		.filter((line) => line.trim() !== "");
	return lines[0] ?? "Tool call failed.";
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

function TailLine({ tail }: { tail: string }) {
	if (!tail) {
		return null;
	}
	return (
		<div className="truncate px-2 py-1 font-mono text-muted-foreground text-xs">
			{tail}
		</div>
	);
}

function ErrorPreviewLine({ text }: { text: string }) {
	if (!text) {
		return null;
	}
	return (
		<div className="truncate px-2 py-1.5 text-destructive text-xs">{text}</div>
	);
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

function computeOutput(tool: ToolInvocation): string {
	if (tool.status === "running") {
		return "";
	}
	return cappedOutput(tool.result);
}

function computeTail(tool: ToolInvocation): string {
	if (tool.status !== "running") {
		return "";
	}
	return previewTail(tool.preview);
}

/** Skip the persistent error preview while the panel is open AND there's a
 * body to show it — otherwise it'd duplicate the same text right below it. */
function computeErrorLine(
	tool: ToolInvocation,
	hasBody: boolean,
	open: boolean
): string {
	if (!tool.isError || (hasBody && open)) {
		return "";
	}
	return errorPreviewLine(tool.result);
}

/** ActivityItem: the rich card for a categorized tool call (command/
 * fileEdit/fileRead/search). Exported directly for the turn spine renderer;
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
 * back to the default plain collapsible block. */
export const bridgeToolRegistry: ToolRegistry = [
	{
		match: (tool) => categoryOf(tool.toolName) !== null,
		render: (tool) => {
			const category = categoryOf(tool.toolName);
			if (!category) {
				return null;
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
