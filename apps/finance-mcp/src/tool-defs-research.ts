import { TOOL_NAMES, TOOLS } from "./tool-defs";

// Split out of tool-defs.ts (which is at the project's 300-line-per-file
// cap): B8's search / research / earnings-forecast tool defs, registered on
// the same shared TOOLS/TOOL_NAMES arrays. Loaded via a side-effect import
// in mcp-server.ts, after tool-defs.ts has finished registering its own.

TOOLS.push({
	name: "finance_search",
	description:
		"Search A-share stocks by name or code; returns matching {code, name, exchange}.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Chinese name or code to search, e.g. 茅台 or 600519.",
			},
		},
		required: ["query"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_search");

TOOLS.push({
	name: "finance_research",
	description:
		"Recent analyst research reports for an A-share stock (org, title, " +
		"EPS/PE forecasts for this/next/+2 FY, proxied PDF link).",
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
TOOL_NAMES.add("finance_research");

TOOLS.push({
	name: "finance_earnings_forecast",
	description:
		"Consensus EPS/PE forecast (this FY / next / +2) for an A-share stock, " +
		"aggregated from recent analyst reports.",
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
TOOL_NAMES.add("finance_earnings_forecast");
