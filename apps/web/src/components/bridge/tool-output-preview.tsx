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

const JSON_INDENT = 2;

/** P2-T4: the raw tool input as display text — pretty-printed JSON for
 * structured args, the string itself for a bare-string input (codex shell),
 * and "" when there's nothing worth showing (absent args or an empty
 * object), so the section renders nothing at all. */
export function rawParamsText(args: unknown): string {
	if (args === undefined || args === null) {
		return "";
	}
	if (typeof args === "string") {
		return args;
	}
	let text: string | undefined;
	try {
		text = JSON.stringify(args, null, JSON_INDENT);
	} catch {
		text = String(args);
	}
	if (text === undefined || text === "{}") {
		return "";
	}
	return text;
}

/** The raw input to compute for a card: "" (nothing to render) unless the
 * `showRawParameters` pref is on. */
export function computeRawParams(
	tool: ToolInvocation,
	enabled: boolean
): string {
	return enabled ? rawParamsText(tool.args) : "";
}

/** P2-T4: the compact raw-input section inside a card's expanded detail area,
 * shown only when the `showRawParameters` pref produced text AND the panel is
 * open. Borderless: a tinted `<pre>` that scrolls horizontally rather than
 * wrapping the JSON. */
export function RawParamsSection({
	open,
	text,
}: {
	open: boolean;
	text: string;
}) {
	if (!(open && text)) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1 px-2 pb-2">
			<span className="text-muted-foreground text-xs">Params</span>
			<pre className="max-h-60 overflow-auto whitespace-pre rounded-md bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xs leading-relaxed">
				{text}
			</pre>
		</div>
	);
}
