import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { ToolStatusIcon } from "@better-agent/ui/components/chat/tool-status-icon";
import { cn } from "@better-agent/ui/lib/utils";
import {
	ChevronRightIcon,
	FileTextIcon,
	PencilIcon,
	SearchIcon,
	TerminalIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DiffLine } from "./activity-diff";
import { formatDurationMs } from "./activity-format";

// R1-T3: ActivityItem's header row + the input parsing it needs. P1-T3
// widened it into the shared parts bin for BOTH activity cards — the
// output-shaping helpers moved here so bash-command-card.tsx reuses them
// without an import cycle against bridge-tool-card.tsx.

export type ToolCategory = "command" | "fileEdit" | "fileRead" | "search";

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

/** A shell tool's command — a bare string input (codex) or the
 * `command`/`cmd`/`script` field of an object input (claude/opencode). */
export function commandText(input: unknown): string {
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

interface PrimaryLine {
	icon: ReactNode;
	label?: string;
	text: string;
}

export function primaryLine(
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

/** A running call always shows the spinner; a settled call with `isError`
 * shows the error glyph even on a nominally `complete` status. */
function iconStatus(tool: ToolInvocation): ToolInvocation["status"] {
	if (tool.status === "running") {
		return "running";
	}
	return tool.isError ? "error" : tool.status;
}

/** Shared `ToolStatusIcon` skeleton (packages/ui) with the terminal's own
 * accent colors (blue spinner / emerald check vs the chat card's muted pair). */
export function StatusIcon({ tool }: { tool: ToolInvocation }) {
	return (
		<ToolStatusIcon
			colors={{ complete: "text-emerald-500", running: "text-blue-500" }}
			status={iconStatus(tool)}
		/>
	);
}

function DiffCounts({ lines }: { lines: DiffLine[] }) {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.sign === "+") {
			added++;
		} else if (line.sign === "-") {
			removed++;
		}
	}
	return (
		<span className="shrink-0 font-mono text-xs tabular-nums">
			<span className="text-emerald-600 dark:text-emerald-400">+{added}</span>{" "}
			<span className="text-destructive">-{removed}</span>
		</span>
	);
}

function HeaderLabel({ label }: { label: string | undefined }) {
	if (!label) {
		return null;
	}
	return (
		<span className="shrink-0 font-medium text-muted-foreground">{label}</span>
	);
}

export function HeaderDuration({
	durationMs,
}: {
	durationMs: number | undefined;
}) {
	if (durationMs === undefined) {
		return null;
	}
	return (
		<span className="shrink-0 text-muted-foreground tabular-nums">
			{formatDurationMs(durationMs)}
		</span>
	);
}

export function HeaderChevron({
	hasBody,
	open,
}: {
	hasBody: boolean;
	open: boolean;
}) {
	if (!hasBody) {
		return null;
	}
	return (
		<ChevronRightIcon
			className={cn(
				"size-3.5 shrink-0 text-muted-foreground transition-transform",
				open && "rotate-90"
			)}
		/>
	);
}

export function ToolCardHeader({
	line,
	tool,
	diffLines,
	hasBody,
	open,
	onToggle,
}: {
	line: PrimaryLine;
	tool: ToolInvocation;
	diffLines: DiffLine[] | null;
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
			<HeaderLabel label={line.label} />
			<span className="flex-1 truncate font-mono text-foreground">
				{line.text || tool.title || (
					<span className="text-muted-foreground">{tool.toolName}</span>
				)}
			</span>
			{diffLines ? <DiffCounts lines={diffLines} /> : null}
			<HeaderDuration durationMs={tool.durationMs} />
			<StatusIcon tool={tool} />
			<HeaderChevron hasBody={hasBody} open={open} />
		</button>
	);
}
