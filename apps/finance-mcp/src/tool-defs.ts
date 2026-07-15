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
		"实时行情快照 realtime quote (US/HK/A股): 最新价, 涨跌幅, OHLC, 成交量, 五档盘口 bid/ask " +
		"(美股/港股仅一档). Symbols: 600000.SH / 000001.SZ / 00700.HK / AAPL. Use " +
		"for: 股价 现价 报价 涨跌 盘口 买卖档 price today. Not for: 历史K线 → finance_kline; " +
		"指数 → finance_index_quote.",
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
		"历史K线 OHLCV candles 蜡烛图 (US/HK/A股). period: day/week/month 或分钟线 " +
		"1m/5m/15m/30m/60m; limit 默认 240. Use for: 走势 历史行情 日线 周线 月线 分时 " +
		"candlestick trend history. Not for: 技术指标 → finance_technical; 实时价 → " +
		"finance_quote.",
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
		"A股定期财务报告列表 (年报/中报/一季报/三季报) 含 PDF 直链, 最新在前 (EastMoney). Use for: 财报 " +
		"年报 中报 季报 定期报告 annual report PDF. Not for: 临时公告 → " +
		"finance_announcements; 三表数据 → finance_financial_statements.",
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
		"财报日历 earnings calendar. market=us → Nasdaq 当日财报名单 (date=YYYY-MM-DD); " +
		"market=a → A股业绩预约披露 (date=报告期末, 如 2026-06-30); market=hk → 港交所业绩公告. " +
		"Use for: 财报时间 业绩公布日期 什么时候出财报. Not for: 预告内容 → " +
		"finance_earnings_preannounce; 宏观数据日历 → finance_economic_calendar.",
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
		"美国宏观数据发布日历 (FRED): CPI/PPI/非农/GDP/FOMC/PMI 的发布名称+日期 (无实际/预期值). " +
		"from/to=YYYY-MM-DD; 默认关键指标, event 搜单项, all=true 全量. US only. Use " +
		"for: 经济日历 数据公布时间 非农时间 议息 FOMC 日期. Not for: 指标数值 → finance_macro_us.",
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
		"央行公开市场操作 OMO. market=us → 纽约联储 repo/逆回购 (近两周, 日期/类型/规模); market=cn " +
		"(人民银行 PBOC 逆回购) 暂无合规免费源, 返回空. Use for: 流动性 投放 回笼 repo 逆回购. Not for: " +
		"利率曲线 → finance_yield_curve.",
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
		"A股估值快照 (EastMoney): 市盈率 PE (TTM/静态), 市净率 PB, 市销率 PS, PCF, PEG, " +
		"总市值/流通市值, 股本. Use for: 估值 贵不贵 便宜 市值多少 valuation multiples. Not for: " +
		"ROE 等财务指标 → finance_financial_indicators; 美股估值 → finance_sec_facts.",
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
		"A股公司资料 F10 profile: 所属行业, 主营业务范围, 董事长, 员工数, 注册资本, 上市日期, 地址. Use for: " +
		"公司简介 做什么的 主营 基本资料 introduction. Not for: 板块概念归属 → " +
		"finance_stock_boards.",
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
		"A股财务三表原始科目 (EastMoney). statement=income 利润表 (营收/成本/净利润) | balance " +
		"资产负债表 (资产/负债/权益/负债率) | cashflow 现金流量表 (经营/投资/筹资). periods 默认 4. Use " +
		"for: 三大报表 资产 负债 现金流 balance sheet income statement. Not for: 衍生指标同比 " +
		"→ finance_financial_indicators; 美股 → finance_sec_facts.",
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
		"A股每期关键财务指标 (基本面首选): EPS, BPS, 营收+同比, 净利润+同比, 毛利率, 净利率, ROE, 负债率, " +
		"每股经营现金流. periods 默认 8. Use for: 基本面 业绩 盈利能力 成长性 同比增速 fundamentals. " +
		"Not for: 原始报表科目 → finance_financial_statements; 估值 → " +
		"finance_key_metrics.",
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
