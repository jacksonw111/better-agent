import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { flattenToolResult } from "./tool-result-text";

// P1-T3: shared output shaping for the terminal-style tool cards
// (BashCommandCard and ActivityItem) — the capped output body, the live
// preview tail while running, and the persistent one-line error preview.
// Split out of activity-item-header.tsx purely for the repo's 300-line cap.

const OUTPUT_CHAR_CAP = 4000;

function cappedOutput(result: unknown): string {
	const text = flattenToolResult(result).trimEnd();
	return text.length > OUTPUT_CHAR_CAP
		? `${text.slice(0, OUTPUT_CHAR_CAP)}\n…(truncated)`
		: text;
}

/** The last non-blank line of a running call's live `preview` (REPLACE
 * semantics — `preview` is already the latest snapshot, bridge-events.ts). */
function previewTail(preview: string | undefined): string {
	if (!preview) {
		return "";
	}
	const lines = preview.split("\n").filter((line) => line.trim() !== "");
	return lines.at(-1) ?? "";
}

/** A persistent one-line error preview (first non-blank line, where the
 * message usually lives) — parity with cloud's `PlainToolView`, whose error
 * line sits outside the collapsible panel so it stays visible collapsed. */
function errorPreviewLine(result: unknown): string {
	const lines = cappedOutput(result)
		.split("\n")
		.filter((line) => line.trim() !== "");
	return lines[0] ?? "Tool call failed.";
}

export function computeOutput(tool: ToolInvocation): string {
	if (tool.status === "running") {
		return "";
	}
	return cappedOutput(tool.result);
}

export function computeTail(tool: ToolInvocation): string {
	if (tool.status !== "running") {
		return "";
	}
	return previewTail(tool.preview);
}

/** Skip the persistent error preview while an open panel already shows the
 * same text right below it. */
export function computeErrorLine(
	tool: ToolInvocation,
	hasBody: boolean,
	open: boolean
): string {
	if (!tool.isError || (hasBody && open)) {
		return "";
	}
	return errorPreviewLine(tool.result);
}

export function TailLine({ tail }: { tail: string }) {
	if (!tail) {
		return null;
	}
	return (
		<div className="truncate px-2 py-1 font-mono text-muted-foreground text-xs">
			{tail}
		</div>
	);
}

export function ErrorPreviewLine({ text }: { text: string }) {
	if (!text) {
		return null;
	}
	return (
		<div className="truncate px-2 py-1.5 text-destructive text-xs">{text}</div>
	);
}
