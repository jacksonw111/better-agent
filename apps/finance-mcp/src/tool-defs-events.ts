import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V7 batch: market-events tools (大宗交易/高管增减持/停复牌; all EastMoney
// datacenter). New file — tool-defs.ts is at the project's 300-line-per-file
// cap, so both the tool defs and the handlers for this batch live in
// dedicated files. Loaded via a side-effect import in mcp-server.ts, after
// the other tool-defs-*.ts modules have registered.

TOOLS.push({
	name: "finance_block_trades",
	description:
		"大宗交易 (block trades): 成交价/溢价率%/成交额, 买卖方营业部席位. " +
		"Market-wide latest by amount, or by symbol.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Optional A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			limit: {
				type: "number",
				description: "Number of rows (default 20, max 60).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_block_trades");

TOOLS.push({
	name: "finance_insider_trades",
	description:
		"高管/股东增减持 (insider buy/sell): 变动人/职务, 增持or减持(HOLD_TYPE), " +
		"变动股数/均价/金额/比例, 原因. Market-wide latest, or by symbol.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Optional A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			limit: {
				type: "number",
				description: "Number of rows (default 20, max 60).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_insider_trades");

TOOLS.push({
	name: "finance_suspension",
	description:
		"停复牌 (trading halts): 停牌起始/复牌时间, 停牌期限, 原因, 预计复牌日. " +
		"Currently-halted/recent.",
	inputSchema: {
		type: "object",
		properties: {
			limit: {
				type: "number",
				description: "Number of rows (default 30, max 100).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_suspension");
