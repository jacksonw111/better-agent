import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V7 batch: market-events tools (大宗交易/高管增减持/停复牌; all EastMoney
// datacenter). New file — tool-defs.ts is at the project's 300-line-per-file
// cap, so both the tool defs and the handlers for this batch live in
// dedicated files. Loaded via a side-effect import in mcp-server.ts, after
// the other tool-defs-*.ts modules have registered.

TOOLS.push({
	name: "finance_block_trades",
	description:
		"A股大宗交易: 成交价, 折溢价率 %, 成交额, 买卖方营业部席位. 全市场最新或按 symbol. Use for: 大宗 折价 " +
		"溢价 机构接盘 block trade. Not for: 龙虎榜 → finance_dragon_tiger.",
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
		"A股高管/重要股东增减持: 变动人/职务, 增持或减持, 股数/均价/金额/比例, 原因. 全市场最新或按 symbol. Use " +
		"for: 增持 减持 高管买卖 股东变动 insider. Not for: 解禁 → finance_lockup; 十大股东 → " +
		"finance_top_holders.",
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
		"A股停复牌: 停牌起始/复牌时间, 停牌期限, 原因, 预计复牌日. Use for: 停牌 复牌 halt suspension " +
		"resumption.",
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
