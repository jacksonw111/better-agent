import { TOOL_NAMES, TOOLS } from "./tool-defs";

// 舆情/热度层 tool defs, ported from the a-stock-data skill: 同花顺热榜 +
// 强势股题材归因 + 东财个股概念命中 + 互动易投资者问答. Loaded via a
// side-effect import in mcp-server.ts, same pattern as tool-defs-signals.ts.

TOOLS.push({
	name: "finance_hot_list",
	description:
		"A股同花顺热榜 (period=hour|day): 人气值, 概念标签, 排名变化, 涨跌幅 — 热度自带概念归因. Use for: " +
		"热榜 热门股 人气 热度 关注 概念标签 hot list. Not for: 东财股吧人气榜 → finance_cn_hot; " +
		"强势股题材 → finance_strong_stocks.",
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
		"A股当日强势股题材归因 (同花顺人工 tags, 如 '算力租赁+AI政务'): 涨幅, 换手率, 成交额, 大单净量 — " +
		"回答'为什么走强'. date=YYYY-MM-DD. Use for: 强势股 题材 归因 领涨 妖股 热点. Not for: " +
		"涨停原因 → finance_limit_up_reasons; 热榜 → finance_hot_list.",
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
		"A股个股概念命中 (EastMoney): 这只票当下被市场归到哪些概念在炒 + 命中热度, 按热度降序. Use for: 概念 炒作 " +
		"题材命中 蹭什么热点. Not for: 全部板块归属(静态) → finance_stock_boards; 热门股榜 → " +
		"finance_hot_list.",
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
		"A股互动易问答 (巨潮): 投资者提问 + 公司官方回复 — 查公司如何回应传闻/利好/合作. Use for: 互动易 董秘 " +
		"投资者关系 回应 澄清 问答 IR. Not for: 公告原文 → finance_announcements; 新闻 → " +
		"finance_stock_news.",
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
