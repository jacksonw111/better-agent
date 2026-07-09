import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V3 batch: free A-share tools (dividends, dragon-tiger, top holders; all
// EastMoney datacenter). Split out of tool-defs-market.ts (which is at the
// project's 300-line-per-file cap) — same pattern as tool-defs-market.ts
// splitting out of tool-defs.ts. Loaded via a side-effect import in
// mcp-server.ts, after tool-defs-market.ts has finished registering its own.

TOOLS.push({
	name: "finance_dividends",
	description:
		"A-share dividend & bonus-share history (每10股送转/派息, record/ex-dividend " +
		"dates, progress).",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			limit: {
				type: "number",
				description: "Number of most-recent plans (default 10, max 40).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_dividends");

TOOLS.push({
	name: "finance_dragon_tiger",
	description:
		"龙虎榜: stocks on the daily dragon-tiger list (abnormal trading), by date " +
		"— code, name, change%, turnover, billboard net amount, reason.",
	inputSchema: {
		type: "object",
		properties: {
			date: {
				type: "string",
				description: "Trade date YYYY-MM-DD. Omit for the most recent session.",
			},
			limit: {
				type: "number",
				description: "Number of rows (default 30, max 100).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_dragon_tiger");

TOOLS.push({
	name: "finance_top_holders",
	description:
		"Top-10 free-float shareholders of an A-share (latest reporting period): " +
		"holder, shares, float %, change.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_top_holders");

TOOLS.push({
	name: "finance_prediction_markets",
	description:
		"Polymarket prediction markets — real-money odds on real-world events " +
		"(politics, macro, crypto, sports). Returns top markets by volume (or " +
		"filtered by `query` keyword): question, outcome probabilities, volume, " +
		"end date. Outcome probabilities are live CLOB midpoints (fallback to " +
		"Gamma last price). Great for event-probability / sentiment signals.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Optional keyword filter matched against the question.",
			},
			limit: {
				type: "number",
				description: "Number of markets (default 12, max 50).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_prediction_markets");
