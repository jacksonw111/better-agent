import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V6a batch: event-data tools (业绩预告/限售解禁/可转债/新股IPO; all
// EastMoney datacenter). New file — tools-impl.ts is at the project's
// 300-line-per-file cap, so both the tool defs and the handlers for this
// batch live in dedicated files. Loaded via a side-effect import in
// mcp-server.ts, after the other tool-defs-*.ts modules have registered.

TOOLS.push({
	name: "finance_earnings_preannounce",
	description:
		"A股业绩预告: 预增/预减/首亏/扭亏, 同比增幅区间, 变动原因. 全市场最新或按 symbol. Use for: 业绩预告 预增 " +
		"预亏 暴雷 preannouncement. Not for: 正式财报指标 → " +
		"finance_financial_indicators; 披露时间表 → finance_earnings_calendar.",
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
		"A股限售解禁: 解禁日, 解禁数量/市值, 占总股本 %, 类型. 全市场未来 90 天或按 symbol. 大额解禁=供给压力. " +
		"Use for: 解禁 限售股 减持压力 unlock expiry. Not for: 高管减持 → " +
		"finance_insider_trades.",
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
		"可转债列表: 债券代码/名称, 正股代码, 评级, 上市/到期日, 发行规模/价格. Use for: 可转债 转债 债券 " +
		"convertible bond.",
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
		"新股申购日历: 申购代码/日期, 上市日, 板块, 发行价, 申购上限, 发行/行业 PE. Use for: 新股 打新 申购 上市 " +
		"IPO calendar.",
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

// V6b batch: market-structure tools (指数成分权重/ETF列表/期权链; all
// EastMoney).

TOOLS.push({
	name: "finance_index_weights",
	description:
		"指数成分股权重: index=hs300 沪深300 (默认) | sz50 上证50 | star50 科创50 — 成分股, 权重 " +
		"%, 行业, PE, ROE. Use for: 成分股 权重股 指数构成 index weight. Not for: 板块成分 → " +
		"finance_sector_constituents.",
	inputSchema: {
		type: "object",
		properties: {
			index: {
				type: "string",
				description: "hs300 (default) | sz50 | star50.",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_index_weights");

TOOLS.push({
	name: "finance_etf_list",
	description:
		"A股 ETF 行情列表 (按涨幅排序): 代码, 名称, 最新价, 涨跌幅, 成交量, 换手率. Use for: ETF 基金 " +
		"场内基金 指数基金 哪个ETF在涨. Not for: ETF 期权 → finance_option_chain.",
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
TOOL_NAMES.add("finance_etf_list");

TOOLS.push({
	name: "finance_option_chain",
	description:
		"A股 ETF 期权链 (EastMoney): 50/300/500 ETF 认购/认沽合约, 行权价, 最新价, 涨跌幅, 成交量. " +
		"underlying=300etf (默认) | 50etf | 500etf. 不含希腊字母/IV. Use for: 期权链 " +
		"合约列表 option chain. Not for: 希腊字母/隐波 → finance_option_quote; 美股期权 → " +
		"finance_us_options.",
	inputSchema: {
		type: "object",
		properties: {
			underlying: {
				type: "string",
				description: "300etf (default) | 50etf | 500etf.",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_option_chain");
