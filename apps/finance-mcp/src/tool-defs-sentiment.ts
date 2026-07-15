import { TOOL_NAMES, TOOLS } from "./tool-defs";

// Adanos market-sentiment tools (trending, ticker, market), split into its
// own file rather than tool-defs-extra.ts since every existing tool-defs
// file is at or near the project's 300-line-per-file cap. Loaded via a
// side-effect import in mcp-server.ts, same pattern as tool-defs-extra.ts.

const SOURCE_ENUM = ["reddit", "x", "polymarket", "news"];
const ASSET_ENUM = ["stocks", "crypto"];

TOOLS.push({
	name: "finance_sentiment_trending",
	description:
		"社媒热门股票榜 (Adanos; source=reddit/x/polymarket/news; " +
		"asset=stocks/crypto): buzz, 提及量, 多空比, 趋势. Use for: 美股 热度 社交媒体 讨论 情绪 " +
		"wsb trending. Not for: A股人气 → finance_cn_hot / finance_hot_list.",
	inputSchema: {
		type: "object",
		properties: {
			source: {
				type: "string",
				enum: SOURCE_ENUM,
				description: "Sentiment source (default reddit).",
			},
			asset: {
				type: "string",
				enum: ASSET_ENUM,
				description: "Asset class (default stocks). news covers stocks only.",
			},
			limit: {
				type: "number",
				description: "Number of tickers (default 10, max 50).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sentiment_trending");

TOOLS.push({
	name: "finance_sentiment_ticker",
	description:
		"单 ticker 社媒情绪 (Adanos): buzz, 提及量, 看多看空 %, 7日趋势. Use for: 某股 情绪 舆情 " +
		"多空 讨论量 sentiment. Not for: 多股对比 → finance_sentiment_compare; A股互动 → " +
		"finance_investor_qa.",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "Ticker or crypto symbol, e.g. AAPL / BTC.",
			},
			source: {
				type: "string",
				enum: SOURCE_ENUM,
				description: "Sentiment source (default reddit).",
			},
			asset: {
				type: "string",
				enum: ASSET_ENUM,
				description: "Asset class (default stocks). news covers stocks only.",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sentiment_ticker");

TOOLS.push({
	name: "finance_sentiment_market",
	description:
		"大盘整体社媒情绪 (Adanos, 按 source): 总 buzz, 多空比, 驱动话题. Use for: 市场情绪 恐慌 贪婪 " +
		"整体氛围 mood. Not for: A股打板情绪 → finance_limit_up_sentiment.",
	inputSchema: {
		type: "object",
		properties: {
			source: {
				type: "string",
				enum: SOURCE_ENUM,
				description: "Sentiment source (default reddit).",
			},
			asset: {
				type: "string",
				enum: ASSET_ENUM,
				description: "Asset class (default stocks). news covers stocks only.",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sentiment_market");
