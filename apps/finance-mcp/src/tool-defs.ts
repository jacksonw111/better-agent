export interface ToolDef {
	description: string;
	inputSchema: Record<string, unknown>;
	name: string;
}

// Feature tasks push their defs onto this array.
export const TOOLS: ToolDef[] = [];

export const TOOL_NAMES = new Set<string>();

TOOLS.push({
	name: "finance_quote",
	description:
		"Realtime market quote snapshot for a US, HK, or A-share symbol. Returns last " +
		"price, change %, OHLC, volume, and up to 5 levels of bid/ask depth (五档; US/HK " +
		"expose only level 1). Symbol formats: 600000.SH, 000001.SZ, 00700.HK, AAPL.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Ticker, e.g. 600000.SH / 00700.HK / AAPL.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_quote");

TOOLS.push({
	name: "finance_kline",
	description:
		"Historical OHLCV candles for a US/HK/A-share symbol. period is day, week, month, " +
		"or an intraday minute interval (1m/5m/15m/30m/60m); limit caps the number of " +
		"most-recent candles (default 240).",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Ticker, e.g. 600000.SH / 00700.HK / AAPL.",
			},
			period: {
				type: "string",
				enum: ["day", "week", "month", "1m", "5m", "15m", "30m", "60m"],
				description:
					"Candle period. Default day. Minute values (1m/5m/15m/30m/60m) " +
					"return intraday bars.",
			},
			limit: {
				type: "number",
				description: "Max candles (default 240).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_kline");

TOOLS.push({
	name: "finance_list_reports",
	description:
		"List an A-share company's periodic financial reports (annual / H1 / Q1 / Q3) from " +
		"EastMoney, newest first. Each item includes artCode, title, reportType, noticeDate, " +
		"and pdfUrl (a proxied link to the full PDF).",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600000.SH.",
			},
			years: {
				type: "number",
				description: "Look-back window in years (default 2).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_list_reports");

TOOLS.push({
	name: "finance_earnings_calendar",
	description:
		"Earnings / report-release dates. market='us' → Nasdaq calendar for a given day " +
		"(date=YYYY-MM-DD). market='a' → A-share appointed-disclosure schedule for a fiscal " +
		"period-end (date=YYYY-MM-DD, e.g. 2026-06-30 for H1). market='hk' → HK " +
		"results-announcement filings (Interim/Final/Quarterly Results + Board-Meeting " +
		"notices) from HKEXnews for the given calendar day (date=YYYY-MM-DD) — actual " +
		"filing dates, since HK has no forward appointment schedule like A-share.",
	inputSchema: {
		type: "object",
		properties: {
			market: {
				type: "string",
				enum: ["us", "a", "hk"],
				description: "Market.",
			},
			date: {
				type: "string",
				description:
					"US: calendar day. A-share: fiscal period-end (YYYY-MM-DD).",
			},
		},
		required: ["market", "date"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_earnings_calendar");

TOOLS.push({
	name: "finance_economic_calendar",
	description:
		"US economic data-RELEASE SCHEDULE (CPI, PPI, non-farm payrolls, GDP, FOMC, PMI, etc.) " +
		"from the free FRED (St. Louis Fed) release-dates API: release name + date only " +
		"(no actual/estimate/prior values). US only. from/to are YYYY-MM-DD; country is an " +
		"optional ISO-2 filter, but only US is covered — any other value returns no results. " +
		"By default returns only KEY US macro releases (CPI, PPI, Employment Situation, GDP, " +
		"PCE, Retail Sales, JOLTS, Industrial Production, Housing, Consumer Sentiment, ECI); " +
		"use `event` to search a specific indicator or `all=true` for the full FRED schedule.",
	inputSchema: {
		type: "object",
		properties: {
			from: { type: "string", description: "Start date YYYY-MM-DD." },
			to: { type: "string", description: "End date YYYY-MM-DD." },
			country: {
				type: "string",
				description:
					"Optional ISO-2 filter. Only US is supported; other values return [].",
			},
			all: {
				type: "boolean",
				description:
					"Return ALL releases instead of only key macro indicators (default false).",
			},
			event: {
				type: "string",
				description:
					"Filter to releases whose name contains this text, e.g. 'CPI' or 'Employment' (case-insensitive).",
			},
		},
		required: ["from", "to"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_economic_calendar");

TOOLS.push({
	name: "finance_central_bank",
	description:
		"Recent central-bank money-market operations. market='us' → NY Fed repo & " +
		"reverse-repo operations (date, type, total amount accepted), last ~2 weeks. " +
		"market='cn' (PBOC 逆回购) currently returns no data — there is no compliant " +
		"free structured source (the only feed, pbc.gov.cn HTML, disallows automated " +
		"access via robots.txt); use official channels for PBOC OMO.",
	inputSchema: {
		type: "object",
		properties: {
			market: {
				type: "string",
				enum: ["cn", "us"],
				description: "cn (PBOC) or us (Fed).",
			},
		},
		required: ["market"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_central_bank");

TOOLS.push({
	name: "finance_key_metrics",
	description:
		"A-share only. Latest valuation snapshot from EastMoney: trade date, close, change %, " +
		"total/float market cap, total/float shares, and PE (TTM/static), PB, PS, PCF, PEG. " +
		"Symbol like 600519.SH / 000001.SZ.",
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
TOOL_NAMES.add("finance_key_metrics");

TOOLS.push({
	name: "finance_company_profile",
	description:
		"A-share only. Company profile from EastMoney F10: name, industry (EM + CSRC), " +
		"listing market, chairman, employee count, registered capital, business scope, " +
		"address, listing date, and founding date. Symbol like 600519.SH / 000001.SZ.",
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
TOOL_NAMES.add("finance_company_profile");

TOOLS.push({
	name: "finance_financial_statements",
	description:
		"A-share only. Raw financial-statement line items from EastMoney, newest first. " +
		"statement=income → revenue/operating cost/operating profit/total profit/net profit " +
		"(incl. deducted). statement=balance → total assets/liabilities/equity, cash, debt " +
		"ratio. statement=cashflow → operating/investing/financing cashflow and net cash " +
		"change. periods caps the number of report periods (default 4, max 20).",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			statement: {
				type: "string",
				enum: ["income", "balance", "cashflow"],
				description: "Which statement to return.",
			},
			periods: {
				type: "number",
				description:
					"Number of report periods, newest first (default 4, max 20).",
			},
		},
		required: ["symbol", "statement"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_financial_statements");

TOOLS.push({
	name: "finance_financial_indicators",
	description:
		"A-share only, highest-value fundamentals tool. Per-period key financial indicators " +
		"from EastMoney: EPS, BPS, revenue + YoY %, net profit + YoY %, gross margin, net " +
		"margin, ROE (weighted + deducted), debt ratio, operating cashflow per share. " +
		"periods caps the number of report periods (default 8, max 40).",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			periods: {
				type: "number",
				description:
					"Number of report periods, newest first (default 8, max 40).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_financial_indicators");

// B8's finance_search / finance_research / finance_earnings_forecast defs
// live in tool-defs-research.ts (side-effect import in mcp-server.ts) — this
// file is at the project's 300-line-per-file cap.
