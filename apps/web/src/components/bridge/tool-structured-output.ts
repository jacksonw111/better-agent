import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";

// fix-tool-render-gaps: shared helpers for the local-agent tool cards that need
// the STRUCTURED tool output (WebSearch's source list, WebFetch's HTTP code…),
// not the flattened text `applyToolResult` stores on `tool.result`. Because a
// generic tool's object output is round-tripped through `flattenToolResult`'s
// pretty-printed JSON fallback (see tool-result-text.ts), the record is
// recoverable by parsing that string back — done defensively so a non-JSON or
// malformed result simply yields `undefined` and the card degrades gracefully.

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

export function readString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** The tool's output as a structured value: the raw object when the fold kept
 * one, else the object recovered by parsing the flattened-JSON string that
 * `applyToolResult` stores. Returns `undefined` for plain text / on any parse
 * failure so callers fall back to showing the flattened text instead. */
function parseJsonish(text: string): unknown {
	const trimmed = text.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit for eslint consistent-return
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		// biome-ignore lint/complexity/noUselessUndefined: explicit for eslint consistent-return
		return undefined;
	}
}

export function structuredOutput(tool: ToolInvocation): unknown {
	const result = tool.result;
	if (result !== null && typeof result === "object") {
		return result;
	}
	if (typeof result === "string") {
		return parseJsonish(result);
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit for eslint consistent-return
	return undefined;
}

/** The tool's structured output narrowed to a record, or `undefined`. */
export function outputRecord(
	tool: ToolInvocation
): Record<string, unknown> | undefined {
	return asRecord(structuredOutput(tool));
}
