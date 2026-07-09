import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V4 batch: margin (融资融券) + price↔sentiment divergence signal tool defs,
// split into a new file since tool-defs.ts is at the project's
// 300-line-per-file cap — same pattern as tool-defs-extra.ts. Loaded via a
// side-effect import in mcp-server.ts.

TOOLS.push({
	name: "finance_margin",
	description:
		"A-share 融资融券 (margin) history: 融资余额/买入额, 融券余额/余量, 融资融券余额, " +
		"融资余额占比. A-share only.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			limit: {
				type: "number",
				description: "Number of most-recent trading days (default 10, max 60).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_margin");

TOOLS.push({
	name: "finance_divergence",
	description:
		"Price↔sentiment divergence signal for a (US) ticker: combines recent " +
		"price trend (kline) with Adanos crowd sentiment to flag 顶背离/底背离/共振. " +
		"source = sentiment source (x/reddit/polymarket/news).",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "US ticker, e.g. AAPL.",
			},
			source: {
				type: "string",
				enum: ["reddit", "x", "polymarket", "news"],
				description: "Sentiment source (default x).",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_divergence");
