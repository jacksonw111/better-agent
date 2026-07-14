import { TOOL_NAMES, TOOLS } from "./tool-defs";

// 舆情/热度层 tool defs, ported from the a-stock-data skill: 同花顺热榜 +
// 强势股题材归因 + 东财个股概念命中 + 互动易投资者问答. Loaded via a
// side-effect import in mcp-server.ts, same pattern as tool-defs-signals.ts.

TOOLS.push({
	name: "finance_hot_list",
	description:
		"A股同花顺热榜: 人气值, 概念标签 (concept tags), 排名变化, 涨跌幅. " +
		"Complements finance_cn_hot (EastMoney rank) with THS heat + 概念归因 in one call.",
	inputSchema: {
		type: "object",
		properties: {
			period: {
				type: "string",
				enum: ["hour", "day"],
				description: "Ranking window (default hour).",
			},
			limit: {
				type: "number",
				description: "Number of stocks (default 20, max 100).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_hot_list");

TOOLS.push({
	name: "finance_strong_stocks",
	description:
		"A股当日强势股 + 题材归因 (同花顺编辑部人工 reason tags, e.g. " +
		"'算力租赁+AI政务'): 涨幅, 换手率, 成交额, 大单净量. Answers WHY a stock is strong.",
	inputSchema: {
		type: "object",
		properties: {
			date: {
				type: "string",
				description: "Trading day, YYYY-MM-DD, e.g. 2026-07-14.",
			},
		},
		required: ["date"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_strong_stocks");

TOOLS.push({
	name: "finance_hot_concepts",
	description:
		"A股个股热门概念命中 (EastMoney): which concepts the market is currently " +
		"trading this stock under, with hit heat, sorted hottest first. A-share only.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 002594.SZ.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_hot_concepts");

TOOLS.push({
	name: "finance_investor_qa",
	description:
		"A股互动易投资者问答 (巨潮): investor questions + official company replies — " +
		"how a company responds to rumors/news. Unique IR signal, A-share only.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 002594.SZ / 600519.SH.",
			},
			limit: {
				type: "number",
				description: "Number of Q&A entries (default 20, max 50).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_investor_qa");
