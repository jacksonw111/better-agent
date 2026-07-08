export interface ToolDef {
	description: string;
	inputSchema: Record<string, unknown>;
	name: string;
}

// Feature tasks push their defs onto this array.
export const TOOLS: ToolDef[] = [];

export const TOOL_NAMES = new Set<string>();

TOOLS.push({
	name: "finance_quote",
	description:
		"Realtime market quote snapshot for a US, HK, or A-share symbol. Returns last " +
		"price, change %, OHLC, volume, and up to 5 levels of bid/ask depth (五档; US/HK " +
		"expose only level 1). Symbol formats: 600000.SH, 000001.SZ, 00700.HK, AAPL.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Ticker, e.g. 600000.SH / 00700.HK / AAPL.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_quote");

TOOLS.push({
	name: "finance_kline",
	description:
		"Historical OHLCV candles for a US/HK/A-share symbol. period is day, week, or " +
		"month; limit caps the number of most-recent candles (default 240).",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Ticker, e.g. 600000.SH / 00700.HK / AAPL.",
			},
			period: {
				type: "string",
				enum: ["day", "week", "month"],
				description: "Candle period. Default day.",
			},
			limit: {
				type: "number",
				description: "Max candles (default 240).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_kline");
