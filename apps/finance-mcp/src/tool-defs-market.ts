import { TOOL_NAMES, TOOLS } from "./tool-defs";

// Split out of tool-defs.ts (which is at the project's 300-line-per-file
// cap): B6's index-quote / commodity-quote tool defs, registered on the same
// shared TOOLS/TOOL_NAMES arrays. Loaded via a side-effect import in
// mcp-server.ts, after tool-defs.ts has finished registering its own.

TOOLS.push({
	name: "finance_index_quote",
	description:
		"Real-time quotes for major stock indices (region=cn/us/hk/all): " +
		"level, change%, high, low.",
	inputSchema: {
		type: "object",
		properties: {
			region: {
				type: "string",
				enum: ["cn", "us", "hk", "all"],
				description: "Index region filter (default all).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_index_quote");

TOOLS.push({
	name: "finance_commodity",
	description:
		"Real-time quotes for key commodities (COMEX gold, WTI crude oil, " +
		"COMEX silver): price, change%, high, low.",
	inputSchema: {
		type: "object",
		properties: {},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_commodity");

TOOLS.push({
	name: "finance_technical",
	description:
		"Technical indicators (MA5/10/20/60, EMA12/26, MACD, RSI14, KDJ, BOLL) " +
		"computed from daily/weekly/monthly candles for a US/HK/A-share symbol. " +
		"Returns the latest snapshot; indicators with insufficient history are null.",
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
				description: "Candle period (default day).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_technical");
