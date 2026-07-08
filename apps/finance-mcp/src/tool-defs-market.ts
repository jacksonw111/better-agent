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
