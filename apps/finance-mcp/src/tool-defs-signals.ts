import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V4/V5 batch: margin (融资融券) + price↔sentiment divergence signal +
// sentiment compare + 股东户数 + A股人气榜 tool defs, split into a new file
// since tool-defs.ts is at the project's 300-line-per-file cap — same
// pattern as tool-defs-extra.ts. Loaded via a side-effect import in
// mcp-server.ts.

TOOLS.push({
	name: "finance_margin",
	description:
		"A股融资融券历史: 融资余额/买入额/偿还, 融券余额/余量, 两融余额, 融资余额占比. Use for: 两融 融资 融券 杠杆资金 " +
		"margin balance. Not for: 主力资金 → finance_money_flow.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			limit: {
				type: "number",
				description: "Number of most-recent trading days (default 10, max 60).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_margin");

TOOLS.push({
	name: "finance_divergence",
	description:
		"价格与情绪背离信号 (US ticker): K线趋势 × 社媒情绪 → 顶背离/底背离/共振. " +
		"source=x/reddit/polymarket/news. Use for: 背离 情绪错配 divergence signal. " +
		"Not for: 单看情绪 → finance_sentiment_ticker.",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "US ticker, e.g. AAPL.",
			},
			source: {
				type: "string",
				enum: ["reddit", "x", "polymarket", "news"],
				description: "Sentiment source (default x).",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_divergence");

TOOLS.push({
	name: "finance_sentiment_compare",
	description:
		"多 ticker 社媒情绪对比 (逗号分隔): buzz, 多空 %, 提及量. Use for: 对比 比较 哪个更热 compare " +
		"sentiment.",
	inputSchema: {
		type: "object",
		properties: {
			tickers: {
				type: "string",
				description: "Comma-separated tickers, e.g. AAPL,MSFT,TSLA.",
			},
			source: {
				type: "string",
				enum: ["reddit", "x", "polymarket", "news"],
				description: "Sentiment source (default x).",
			},
			asset: {
				type: "string",
				enum: ["stocks", "crypto"],
				description: "Asset class (default stocks).",
			},
		},
		required: ["tickers"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sentiment_compare");

TOOLS.push({
	name: "finance_holder_count",
	description:
		"A股股东户数时间序列: 户数, 环比变动 %, 户均流通股. 户数下降=筹码集中 (偏多信号). Use for: 股东户数 筹码 " +
		"集中度 散户人数. Not for: 十大股东 → finance_top_holders.",
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
TOOL_NAMES.add("finance_holder_count");

TOOLS.push({
	name: "finance_cn_hot",
	description:
		"A股东财股吧人气榜: 股民关注度排名 + 排名变化 + 现价涨跌. Use for: 人气榜 关注度 散户热度 股吧 东财 " +
		"popularity. Not for: 同花顺热榜(带概念标签) → finance_hot_list; 个股概念命中 → " +
		"finance_hot_concepts; 强势股归因 → finance_strong_stocks.",
	inputSchema: {
		type: "object",
		properties: {
			limit: {
				type: "number",
				description: "Number of ranked stocks (default 20, max 50).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_cn_hot");
