export interface ToolResult {
	content: { type: "text"; text: string }[];
	isError: boolean;
}

export function toolText(text: string, isError = false): ToolResult {
	return { content: [{ type: "text", text }], isError };
}

export function toolJson(value: unknown): ToolResult {
	return toolText(JSON.stringify(value));
}

// Feature tasks add `if (name === "finance_x") { ... }` branches above the fallback.
export function runTool(
	name: string,
	_args: Record<string, unknown>
): Promise<ToolResult> {
	return Promise.resolve(toolText(`Unknown tool: ${name}`, true));
}
