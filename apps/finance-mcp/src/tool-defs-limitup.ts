import { TOOL_NAMES, TOOLS } from "./tool-defs";

// 打板层 (limit-up trading) tool defs, ported from the a-stock-data skill:
// 东财 push2ex 四池 (涨停/炸板/跌停/昨涨停) + 同花顺涨停揭秘 (涨停原因题材) +
// 打板情绪速算. Loaded via a side-effect import in mcp-server.ts, same
// pattern as tool-defs-signals.ts.

TOOLS.push({
	name: "finance_limit_up_pool",
	description:
		"A股打板四池 (EastMoney): 涨停池(zt) / 炸板池(zb) / 跌停池(dt) / 昨日涨停池(yzt). " +
		"Per stock: 连板数, 封板时间, 封板资金, 炸板次数, 行业, N天M板. " +
		"date must be a trading day (YYYYMMDD).",
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
		"A股涨停揭秘 (同花顺): 涨停原因题材 (reason tags), 板型 (换手板/一字板/T字板), " +
		"封板成功率, 封单额, 几天几板. The 'why it hit limit-up' enrichment for the zt pool.",
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
		"A股打板情绪温度计: 涨停/炸板/跌停家数, 炸板率%, 最高连板高度, 连板梯队 " +
		"(板数→家数). Composed from the EastMoney 打板 pools for one trading day.",
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
