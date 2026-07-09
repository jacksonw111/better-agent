import { TOOL_NAMES, TOOLS } from "./tool-defs";

// V4/V5 batch: margin (融资融券) + price↔sentiment divergence signal +
// sentiment compare + 股东户数 + A股人气榜 tool defs, split into a new file
// since tool-defs.ts is at the project's 300-line-per-file cap — same
// pattern as tool-defs-extra.ts. Loaded via a side-effect import in
// mcp-server.ts.

TOOLS.push({
	name: "finance_margin",
	description:
		"A-share 融资融券 (margin) history: 融资余额/买入额, 融券余额/余量, 融资融券余额, " +
		"融资余额占比. A-share only.",
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
		"Price↔sentiment divergence signal for a (US) ticker: combines recent " +
		"price trend (kline) with Adanos crowd sentiment to flag 顶背离/底背离/共振. " +
		"source = sentiment source (x/reddit/polymarket/news).",
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
		"Compare social/market sentiment across multiple tickers (buzz, bull/bear %, mentions). " +
		"tickers = comma-separated. Adanos.",
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
		"A-share 股东户数 (shareholder count) time series: 户数, 较上期变动%, 户均流通股. " +
		"Falling 户数 = 筹码集中 (bullish). A-share only.",
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
		"A股股吧人气榜 (EastMoney retail-attention rank) — top stocks by 股民关注度, with rank " +
		"change, live price & change%. A CN attention/sentiment proxy.",
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
