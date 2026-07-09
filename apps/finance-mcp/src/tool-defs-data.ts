import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V6a batch: event-data tools (业绩预告/限售解禁/可转债/新股IPO; all
// EastMoney datacenter). New file — tools-impl.ts is at the project's
// 300-line-per-file cap, so both the tool defs and the handlers for this
// batch live in dedicated files. Loaded via a side-effect import in
// mcp-server.ts, after the other tool-defs-*.ts modules have registered.

TOOLS.push({
	name: "finance_earnings_preannounce",
	description:
		"业绩预告 (earnings pre-announcements): 预增/预减/首亏/扭亏, 同比增幅区间, 原因. " +
		"Market-wide latest, or filter by symbol.",
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
TOOL_NAMES.add("finance_earnings_preannounce");

TOOLS.push({
	name: "finance_lockup",
	description:
		"限售解禁 (lockup expiry): 解禁日/数量/占总股本%/解禁市值/类型. Upcoming " +
		"market-wide, or by symbol. Large unlocks = supply overhang.",
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
TOOL_NAMES.add("finance_lockup");

TOOLS.push({
	name: "finance_convertible_bonds",
	description:
		"可转债列表 (convertible bonds): 债券代码/名称, 正股代码, 评级, 上市/到期日, " +
		"发行规模/价格.",
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
TOOL_NAMES.add("finance_convertible_bonds");

TOOLS.push({
	name: "finance_ipo",
	description:
		"新股申购日历 (IPO calendar): 申购代码/日期, 上市日, 板块, 发行价, 申购上限, " +
		"发行/行业PE.",
	inputSchema: {
		type: "object",
		properties: {
			limit: {
				type: "number",
				description: "Number of rows (default 20, max 60).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_ipo");
