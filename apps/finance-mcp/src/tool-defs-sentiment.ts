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
		"Trending tickers by social/market buzz & sentiment (source: reddit/x/polymarket/news; " +
		"asset: stocks/crypto) — buzz score, mentions, bullish/bearish %, trend. Adanos.",
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
		"Sentiment for a specific ticker/symbol across a source (buzz, mentions, bull/bear %, " +
		"7-day daily trend).",
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
		"Overall market sentiment for a source (aggregate buzz, bull/bear %, top drivers).",
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
