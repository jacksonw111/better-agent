import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V3 batch: free A-share tools (dividends, dragon-tiger, top holders; all
// EastMoney datacenter). Split out of tool-defs-market.ts (which is at the
// project's 300-line-per-file cap) — same pattern as tool-defs-market.ts
// splitting out of tool-defs.ts. Loaded via a side-effect import in
// mcp-server.ts, after tool-defs-market.ts has finished registering its own.

TOOLS.push({
	name: "finance_dividends",
	description:
		"A股分红送转历史: 每10股送/转/派息, 股权登记日, 除权除息日, 实施进度. Use for: 分红 派息 送股 转增 股息 除权 " +
		"dividend. Not for: 美股股息 → finance_sec_facts.",
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
		"龙虎榜 (按日期): 上榜股票, 涨跌幅, 换手, 龙虎榜净买额, 上榜原因. Use for: 龙虎榜 游资 席位 营业部 异动 上榜 " +
		"机构买卖. Not for: 大宗交易 → finance_block_trades; 涨停池 → " +
		"finance_limit_up_pool.",
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
		"A股十大流通股东 (最新报告期): 股东名称, 持股数, 占流通比, 增减变动. Use for: 十大股东 机构持股 股东名单 谁在买 " +
		"holders. Not for: 股东户数 → finance_holder_count; 美股机构 → " +
		"finance_institutional_holders; 高管增减持 → finance_insider_trades.",
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
		"Polymarket 预测市场实钱赔率: 按 24h 交易量排序的热门事件 (政治/宏观/加密/体育), query 关键词过滤. " +
		"返回问题, 各结果实时概率 (CLOB midpoint), 交易量. Use for: 预测市场 概率 赔率 降息概率 大选 " +
		"event odds. Not for: 美国监管盘 → finance_kalshi; 概率历史曲线 → " +
		"finance_prediction_history.",
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
