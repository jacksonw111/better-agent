import { getKline } from "./core/tencent/kline";
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
	if (name === "finance_kline") {
		const symbol = typeof _args.symbol === "string" ? _args.symbol : "";
		const period =
			_args.period === "week" || _args.period === "month"
				? _args.period
				: "day";
		const limit = typeof _args.limit === "number" ? _args.limit : 240;
		return toolJson(await getKline(symbol, period, limit));
	}
	return toolText(`Unknown tool: ${name}`, true);
}
