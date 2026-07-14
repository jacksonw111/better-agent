interface McpTextContent {
	text?: string;
	type: string;
}

interface McpContentEnvelope {
	content: McpTextContent[];
}

function isMcpContentEnvelope(value: unknown): value is McpContentEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as { content?: unknown }).content)
	);
}

function tryParseJson(text: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = undefined;
	}
	return parsed;
}

/** Unwrap a tool-result into a plain JS value ready for schema validation.
 * Handles the three shapes seen in practice: an already-parsed object/array
 * (client tools), the MCP `{content:[{type:"text",text:"<json>"}]}` envelope
 * (apps/mcp's `toolText` helper), and a bare JSON string. Malformed JSON
 * anywhere in the chain resolves to `undefined` so the caller's schema
 * safeParse fails cleanly instead of throwing. */
export function unwrapToolResult(result: unknown): unknown {
	if (typeof result === "string") {
		return tryParseJson(result);
	}
	if (isMcpContentEnvelope(result)) {
		const first = result.content[0];
		return typeof first?.text === "string"
			? tryParseJson(first.text)
			: undefined;
	}
	return result;
}
