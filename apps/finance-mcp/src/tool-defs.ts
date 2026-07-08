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
		"Historical OHLCV candles for a US/HK/A-share symbol. period is day, week, or " +
		"month; limit caps the number of most-recent candles (default 240).",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Ticker, e.g. 600000.SH / 00700.HK / AAPL.",
			},
			period: {
				type: "string",
				enum: ["day", "week", "month"],
				description: "Candle period. Default day.",
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
		"period-end (date=YYYY-MM-DD, e.g. 2026-06-30 for H1). market='hk' is best-effort and " +
		"currently returns no data.",
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
		"Macro economic data-release schedule (CPI, PPI, non-farm payrolls, GDP, FOMC, PMI) " +
		"with actual/estimate/prior. Covers US and China. from/to are YYYY-MM-DD; country is an " +
		"optional ISO-2 filter (US, CN).",
	inputSchema: {
		type: "object",
		properties: {
			from: { type: "string", description: "Start date YYYY-MM-DD." },
			to: { type: "string", description: "End date YYYY-MM-DD." },
			country: {
				type: "string",
				description: "Optional ISO-2 filter, e.g. US or CN.",
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
		"Recent central-bank money-market operations. market='us' → NY Fed repo/reverse-repo " +
		"operations. market='cn' (PBOC 逆回购) is best-effort and currently returns no data — " +
		"the EastMoney source does not expose it; a chinamoney.org.cn integration is deferred " +
		"to v2.",
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
