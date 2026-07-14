import { TOOL_NAMES, TOOLS } from "./tool-defs";

// 美股/港股增强 + 行业新闻 tool defs, ported from the global-stock-data and
// investment-news skills: Yahoo options/analyst/holders + SEC EDGAR + curated
// industry RSS. Loaded via a side-effect import in mcp-server.ts.

TOOLS.push({
	name: "finance_us_options",
	description:
		"US stock option chain (Yahoo): calls + puts with strike, bid/ask, volume, " +
		"open interest, implied volatility, ITM flag, plus all expiration dates. US only.",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "US ticker, e.g. AAPL / TSLA.",
			},
			expiration: {
				type: "number",
				description:
					"Expiry as unix seconds (from expirationDates). Omit for the nearest expiry.",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_us_options");

TOOLS.push({
	name: "finance_analyst_ratings",
	description:
		"US/HK analyst view (Yahoo): EPS + revenue estimates trend, buy/hold/sell " +
		"rating distribution by month, and recent upgrade/downgrade history with firms.",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "Yahoo symbol, e.g. AAPL or 0700.HK.",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_analyst_ratings");

TOOLS.push({
	name: "finance_institutional_holders",
	description:
		"US/HK institutional ownership (Yahoo): insiders/institutions held %, " +
		"institution count, and top-10 institutional holders with shares/value/pct.",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "Yahoo symbol, e.g. AAPL or 0700.HK.",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_institutional_holders");

TOOLS.push({
	name: "finance_sec_filings",
	description:
		"SEC EDGAR filings for a US ticker: form, date, accession number and " +
		"document URL. Filter by form type (10-K/10-Q/8-K/...). US only.",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "US ticker, e.g. AAPL.",
			},
			form_type: {
				type: "string",
				description: "Optional exact form filter, e.g. 10-K.",
			},
			limit: {
				type: "number",
				description: "Number of filings (default 20, max 50).",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sec_filings");

TOOLS.push({
	name: "finance_sec_facts",
	description:
		"SEC EDGAR XBRL company facts (US GAAP) for a US ticker: multi-year audited " +
		"metrics from 10-K/10-Q (e.g. NetIncomeLoss, EarningsPerShareDiluted, Assets). " +
		"Empty metrics = list all available metric names.",
	inputSchema: {
		type: "object",
		properties: {
			ticker: {
				type: "string",
				description: "US ticker, e.g. AAPL.",
			},
			metrics: {
				type: "string",
				description:
					"Comma-separated XBRL metric names, e.g. NetIncomeLoss,Assets. Empty = list available.",
			},
		},
		required: ["ticker"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sec_facts");

TOOLS.push({
	name: "finance_kalshi",
	description:
		"Kalshi prediction markets (US CFTC-regulated, clean macro structure: Fed, " +
		"CPI, elections, geopolitics): yes price/bid/ask, 24h volume, open interest. " +
		"Client-sorted by 24h volume. Complements finance_prediction_markets (Polymarket).",
	inputSchema: {
		type: "object",
		properties: {
			series: {
				type: "string",
				description:
					"Optional series_ticker filter, e.g. KXFED (Fed rates), KXCPIYOY.",
			},
			query: {
				type: "string",
				description: "Optional keyword filter on market titles.",
			},
			limit: {
				type: "number",
				description: "Number of markets (default 20, max 50).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_kalshi");

TOOLS.push({
	name: "finance_prediction_history",
	description:
		"Polymarket probability time series for the top market matching a query " +
		"(Yes outcome): how the market-implied probability trended over time.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Keyword to match the market question, e.g. Fed cut.",
			},
			interval: {
				type: "string",
				enum: ["1d", "1w", "1m", "max"],
				description: "History window (default 1w).",
			},
		},
		required: ["query"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_prediction_history");

TOOLS.push({
	name: "finance_industry_news",
	description:
		"Global industry headlines from curated tier-1 RSS sources (per sector), " +
		"merged and sorted newest-first. Sectors: ai, semi, robot, auto, energy, " +
		"bio, space, security, tech, consumer, macro, science.",
	inputSchema: {
		type: "object",
		properties: {
			sector: {
				type: "string",
				enum: [
					"ai",
					"semi",
					"robot",
					"auto",
					"energy",
					"bio",
					"space",
					"security",
					"tech",
					"consumer",
					"macro",
					"science",
				],
				description: "Industry sector key.",
			},
			limit: {
				type: "number",
				description: "Number of headlines (default 20, max 50).",
			},
		},
		required: ["sector"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_industry_news");
