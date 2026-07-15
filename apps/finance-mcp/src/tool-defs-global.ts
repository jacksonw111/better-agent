import { TOOL_NAMES, TOOLS } from "./tool-defs";

// 美股/港股增强 + 行业新闻 tool defs, ported from the global-stock-data and
// investment-news skills: Yahoo options/analyst/holders + SEC EDGAR + curated
// industry RSS. Loaded via a side-effect import in mcp-server.ts.

TOOLS.push({
	name: "finance_us_options",
	description:
		"美股期权链 (Yahoo): calls/puts 行权价, bid/ask, 成交量, 持仓量, 隐含波动率 IV, 价内 ITM, " +
		"全部到期日. Use for: 美股 期权 希腊 iv option chain AAPL TSLA. Not for: A股 ETF " +
		"期权 → finance_option_quote.",
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
		"美股/港股分析师预期 (Yahoo): EPS/营收预测趋势, 买入持有卖出评级分布, 投行升降级历史. Use for: 美股 评级 " +
		"目标价 分析师 一致预期 upgrade downgrade. Not for: A股研报 → finance_research; " +
		"A股一致预期 → finance_earnings_forecast.",
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
		"美股/港股机构持仓 (Yahoo): 内部人/机构持股比例, 机构数量, 前十大机构 (股数/市值/占比). Use for: 机构持仓 " +
		"基金持股 13F holders ownership. Not for: A股十大股东 → finance_top_holders.",
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
		"SEC EDGAR 文件列表 (美股): form 类型, 日期, 文档直链; form_type 过滤 10-K/10-Q/8-K " +
		"等. Use for: SEC 文件 年报 10-K 8-K filing edgar. Not for: 结构化财务数据 → " +
		"finance_sec_facts.",
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
		"SEC XBRL 结构化财务数据 (US GAAP, 美股): 多年审计值如 NetIncomeLoss, " +
		"EarningsPerShareDiluted, Assets; metrics 留空则列出全部可用指标名. Use for: 美股 " +
		"财务数据 营收 净利润 历史 fundamentals. Not for: A股 → " +
		"finance_financial_indicators.",
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
		"Kalshi 预测市场 (美国 CFTC 监管, 宏观结构好): Fed 利率/CPI/大选/地缘事件的 yes 价格, 买卖价, " +
		"24h 量, 持仓. 建议传 series (如 KXFED=联储利率). Use for: 降息概率 加息概率 事件合约 预测 " +
		"kalshi. Not for: Polymarket → finance_prediction_markets.",
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
		"Polymarket 概率历史曲线: 按 query 匹配交易量最大的市场, 返回 Yes 结果概率时间序列 " +
		"(interval=1d/1w/1m/max). Use for: 概率变化 概率走势 趋势 odds history. Not " +
		"for: 当前市场列表 → finance_prediction_markets.",
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
		"全球行业头条 (tier-1 RSS 精选源, 按时间归并): " +
		"sector=ai/semi/robot/auto/energy/bio/space/security/tech/consumer/macro/science. " +
		"Use for: 行业新闻 产业动态 AI 芯片 半导体 机器人 新能源 航天 资讯. Not for: 财经快讯 → " +
		"finance_news; 个股新闻 → finance_stock_news.",
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
