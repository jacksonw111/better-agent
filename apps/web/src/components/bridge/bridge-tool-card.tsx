import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { RenderTool } from "@better-agent/ui/components/chat/chat-row";
import { cn } from "@better-agent/ui/lib/utils";
import {
	CheckIcon,
	ChevronRightIcon,
	FileTextIcon,
	Loader2Icon,
	PencilIcon,
	SearchIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { flattenToolResult } from "./tool-result-text";

// R-refactor (Bug 3): renders a LOCAL agent's real CLI tool executions — shell
// commands, file edits, reads, searches — as compact terminal-style cards,
// instead of the generic JSON `ToolGroup` fallback. Wired via ChatRow's
// `renderTool` seam (packages/ui); an uncategorized tool returns null so it
// falls back to the default card. The web-agent chat doesn't use this.

const OUTPUT_CHAR_CAP = 4000;

type ToolCategory = "command" | "fileEdit" | "fileRead" | "search";

const COMMAND_RE = /bash|shell|\bsh\b|zsh|exec|command|\brun\b|terminal/;
const FILE_EDIT_RE = /edit|write|create|patch|replace/;
const FILE_READ_RE = /read|view|\bcat\b|open/;
const SEARCH_RE = /grep|glob|search|find|ripgrep/;

function categoryOf(name: string): ToolCategory | null {
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function firstString(...values: unknown[]): string | undefined {
	return values.find(
		(value): value is string => typeof value === "string" && value !== ""
	);
}

/** The command string for a shell tool — a bare string input (codex) or the
 * `command`/`cmd`/`script` field of an object input (claude/opencode). */
function commandText(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}
	const record = asRecord(input);
	return firstString(record?.command, record?.cmd, record?.script) ?? "";
}

/** The file path for an edit/read tool, across the agents' differing keys. */
function filePath(input: unknown): string {
	const record = asRecord(input);
	return (
		firstString(
			record?.file_path,
			record?.filePath,
			record?.path,
			record?.notebook_path
		) ?? ""
	);
}

/** The query/pattern for a search tool. */
function searchQuery(input: unknown): string {
	const record = asRecord(input);
	return firstString(record?.pattern, record?.query, record?.regex) ?? "";
}

function StatusIcon({ tool }: { tool: ToolInvocation }) {
	if (tool.status === "running") {
		return <Loader2Icon className="size-3.5 animate-spin text-blue-500" />;
	}
	if (tool.isError || tool.status === "error") {
		return <XIcon className="size-3.5 text-destructive" />;
	}
	return <CheckIcon className="size-3.5 text-emerald-500" />;
}

interface PrimaryLine {
	icon: ReactNode;
	label?: string;
	text: string;
}

function primaryLine(
	category: ToolCategory,
	tool: ToolInvocation
): PrimaryLine {
	if (category === "command") {
		return {
			icon: (
				<TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
			),
			text: commandText(tool.args),
		};
	}
	if (category === "fileEdit") {
		return {
			icon: <PencilIcon className="size-3.5 shrink-0 text-amber-500" />,
			label: "Edit",
			text: filePath(tool.args),
		};
	}
	if (category === "fileRead") {
		return {
			icon: (
				<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
			),
			label: "Read",
			text: filePath(tool.args),
		};
	}
	return {
		icon: <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />,
		label: "Search",
		text: searchQuery(tool.args),
	};
}

function cappedOutput(result: unknown): string {
	const text = flattenToolResult(result).trimEnd();
	return text.length > OUTPUT_CHAR_CAP
		? `${text.slice(0, OUTPUT_CHAR_CAP)}\n…(truncated)`
		: text;
}

function ToolCardHeader({
	line,
	tool,
	hasBody,
	open,
	onToggle,
}: {
	line: PrimaryLine;
	tool: ToolInvocation;
	hasBody: boolean;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			aria-expanded={hasBody ? open : undefined}
			className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
			disabled={!hasBody}
			onClick={onToggle}
			type="button"
		>
			{line.icon}
			{line.label ? (
				<span className="shrink-0 font-medium text-muted-foreground">
					{line.label}
				</span>
			) : null}
			<span className="flex-1 truncate font-mono text-foreground">
				{line.text || (
					<span className="text-muted-foreground">{tool.toolName}</span>
				)}
			</span>
			<StatusIcon tool={tool} />
			{hasBody ? (
				<ChevronRightIcon
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-90"
					)}
				/>
			) : null}
		</button>
	);
}

function BridgeToolCard({
	category,
	tool,
}: {
	category: ToolCategory;
	tool: ToolInvocation;
}) {
	const output = tool.status === "running" ? "" : cappedOutput(tool.result);
	const hasBody = output.length > 0;
	const [open, setOpen] = useState(tool.isError);
	return (
		<div
			className={cn(
				"overflow-hidden rounded-md border bg-muted/40 text-xs",
				tool.isError && "border-destructive/40"
			)}
		>
			<ToolCardHeader
				hasBody={hasBody}
				line={primaryLine(category, tool)}
				onToggle={() => setOpen((v) => !v)}
				open={open}
				tool={tool}
			/>
			{hasBody && open ? (
				<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xs leading-relaxed">
					{output}
				</pre>
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
	return <BridgeToolCard category={category} tool={tool} />;
};
