import { getQuote } from "./core/tencent/quote";

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
export async function runTool(
	name: string,
	_args: Record<string, unknown>
): Promise<ToolResult> {
	if (name === "finance_quote") {
		const symbol = typeof _args.symbol === "string" ? _args.symbol : "";
		return toolJson(await getQuote(symbol));
	}
	return toolText(`Unknown tool: ${name}`, true);
}
