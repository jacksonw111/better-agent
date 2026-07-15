import { TOOL_NAMES, TOOLS } from "./tool-defs";

// 打板层 (limit-up trading) tool defs, ported from the a-stock-data skill:
// 东财 push2ex 四池 (涨停/炸板/跌停/昨涨停) + 同花顺涨停揭秘 (涨停原因题材) +
// 打板情绪速算. Loaded via a side-effect import in mcp-server.ts, same
// pattern as tool-defs-signals.ts.

TOOLS.push({
	name: "finance_limit_up_pool",
	description:
		"A股打板四池 (EastMoney): pool=zt 涨停池 | zb 炸板池 | dt 跌停池 | yzt 昨日涨停池. 每股: " +
		"连板数, 封板时间, 封板资金, 炸板次数, 行业, N天M板. date=交易日 YYYYMMDD. Use for: 涨停 跌停 " +
		"连板 打板 封板 首板 二板 晋级率. Not for: 涨停原因题材 → finance_limit_up_reasons; 情绪汇总 " +
		"→ finance_limit_up_sentiment.",
	inputSchema: {
		type: "object",
		properties: {
			pool: {
				type: "string",
				enum: ["zt", "zb", "dt", "yzt"],
				description:
					"Pool kind: zt=涨停 (default), zb=炸板, dt=跌停, yzt=昨日涨停.",
			},
			date: {
				type: "string",
				description: "Trading day, YYYYMMDD, e.g. 20260714.",
			},
		},
		required: ["date"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_limit_up_pool");

TOOLS.push({
	name: "finance_limit_up_reasons",
	description:
		"A股涨停揭秘 (同花顺): 涨停原因题材 tags, 板型 (换手板/一字板/T字板), 封板成功率, 封单额, 几天几板. Use " +
		"for: 涨停原因 为什么涨停 题材 妖股 板型 封板质量. Not for: 四池明细 → " +
		"finance_limit_up_pool; 强势股归因 → finance_strong_stocks.",
	inputSchema: {
		type: "object",
		properties: {
			date: {
				type: "string",
				description: "Trading day, YYYYMMDD, e.g. 20260714.",
			},
		},
		required: ["date"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_limit_up_reasons");

TOOLS.push({
	name: "finance_limit_up_sentiment",
	description:
		"A股打板情绪温度计 (单交易日): 涨停/炸板/跌停家数, 炸板率 %, 最高连板高度, 连板梯队 (板数→家数). Use for: " +
		"打板情绪 赚钱效应 亏钱效应 连板高度 炸板率 市场情绪. Not for: 个股明细 → finance_limit_up_pool; " +
		"社媒情绪 → finance_sentiment_market.",
	inputSchema: {
		type: "object",
		properties: {
			date: {
				type: "string",
				description: "Trading day, YYYYMMDD, e.g. 20260714.",
			},
		},
		required: ["date"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_limit_up_sentiment");
