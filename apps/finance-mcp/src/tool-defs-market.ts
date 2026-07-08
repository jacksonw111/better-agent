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

TOOLS.push({
	name: "finance_money_flow",
	description:
		"Daily fund-flow for an A-share stock: net inflow by order size " +
		"(main-force = large + super-large, plus medium/small), in CNY. " +
		"A-share only.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			days: {
				type: "number",
				description: "Number of trading days of history (default 5, max 60).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_money_flow");

TOOLS.push({
	name: "finance_hsgt_flow",
	description:
		"Shanghai/Shenzhen-Hong Kong Stock Connect (沪深港通) daily fund flow by " +
		"channel (沪股通/深股通/港股通). Northbound (沪股通/深股通) net flow is " +
		"unavailable (null) — mainland exchanges stopped disclosing it on " +
		"2024-08-19; southbound (港股通) is still published.",
	inputSchema: {
		type: "object",
		properties: {
			days: {
				type: "number",
				description: "Number of trading days of history (default 10).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_hsgt_flow");

TOOLS.push({
	name: "finance_sector_list",
	description:
		"Industry or concept sector boards with change% and main-force net " +
		"inflow; leading stock.",
	inputSchema: {
		type: "object",
		properties: {
			type: {
				type: "string",
				enum: ["industry", "concept"],
				description: "Sector board type (default industry).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sector_list");

TOOLS.push({
	name: "finance_sector_constituents",
	description: "Member stocks of a sector board (by board code, e.g. BK0477).",
	inputSchema: {
		type: "object",
		properties: {
			board: {
				type: "string",
				description: "Sector board code, e.g. BK0477.",
			},
		},
		required: ["board"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sector_constituents");
