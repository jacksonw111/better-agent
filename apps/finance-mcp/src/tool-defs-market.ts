import { TOOL_NAMES, TOOLS } from "./tool-defs";

// Split out of tool-defs.ts (which is at the project's 300-line-per-file
// cap): B6's index-quote / commodity-quote tool defs, registered on the same
// shared TOOLS/TOOL_NAMES arrays. Loaded via a side-effect import in
// mcp-server.ts, after tool-defs.ts has finished registering its own.

TOOLS.push({
	name: "finance_index_quote",
	description:
		"主要股指实时行情 (region=cn/us/hk/all): 点位, 涨跌幅, 高低. Use for: 大盘 指数 上证指数 " +
		"深证成指 创业板指 沪深300 恒生指数 纳斯达克 道琼斯 标普 index. Not for: 个股 → finance_quote; " +
		"指数成分 → finance_index_weights.",
	inputSchema: {
		type: "object",
		properties: {
			region: {
				type: "string",
				enum: ["cn", "us", "hk", "all"],
				description: "Index region filter (default all).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_index_quote");

TOOLS.push({
	name: "finance_commodity",
	description:
		"大宗商品实时行情: COMEX 黄金, WTI 原油, 白银 — 价格, 涨跌幅, 高低. Use for: 金价 油价 白银 贵金属 " +
		"商品 gold oil silver. Not for: 宏观指标 → finance_macro_us.",
	inputSchema: {
		type: "object",
		properties: {},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_commodity");

TOOLS.push({
	name: "finance_technical",
	description:
		"技术指标快照 (US/HK/A股, 日/周/月线): MA5/10/20/60, EMA12/26, MACD, RSI14, KDJ, " +
		"BOLL 布林带. Use for: 均线 金叉 死叉 超买 超卖 技术面 技术分析 indicators. Not for: 原始K线 " +
		"→ finance_kline.",
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
				description: "Candle period (default day).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_technical");

TOOLS.push({
	name: "finance_money_flow",
	description:
		"A股个股资金流向 (日级): 主力净流入 (大单+超大单), 中单, 小单, 单位 CNY. Use for: 主力 资金流 净流入 " +
		"流出 吸筹 出货 fund flow. Not for: 北向资金 → finance_hsgt_flow; 板块资金 → " +
		"finance_sector_list; 大宗交易 → finance_block_trades.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000001.SZ.",
			},
			days: {
				type: "number",
				description: "Number of trading days of history (default 5, max 60).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_money_flow");

TOOLS.push({
	name: "finance_hsgt_flow",
	description:
		"沪深港通每日资金流 (沪股通/深股通/港股通). 注意: 北向净买额 2024-08 起停止披露 (返回 null), 南向港股通正常. " +
		"Use for: 北向资金 南向资金 外资 陆股通 northbound southbound. Not for: 个股资金 → " +
		"finance_money_flow.",
	inputSchema: {
		type: "object",
		properties: {
			days: {
				type: "number",
				description: "Number of trading days of history (default 10).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_hsgt_flow");

TOOLS.push({
	name: "finance_sector_list",
	description:
		"行业/概念板块行情榜 (type=industry|concept): 板块涨跌幅, 主力净流入, 领涨股. Use for: 板块 " +
		"行业 概念 轮动 哪个板块在涨 sector board. Not for: 个股属于什么板块 → " +
		"finance_stock_boards; 板块成分股 → finance_sector_constituents.",
	inputSchema: {
		type: "object",
		properties: {
			type: {
				type: "string",
				enum: ["industry", "concept"],
				description: "Sector board type (default industry).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sector_list");

TOOLS.push({
	name: "finance_sector_constituents",
	description:
		"板块成分股列表, 按板块 BK 码 (如 BK0477; 码来自 finance_sector_list 或 " +
		"finance_stock_boards). Use for: 成分股 板块里有哪些股票 members constituents.",
	inputSchema: {
		type: "object",
		properties: {
			board: {
				type: "string",
				description: "Sector board code, e.g. BK0477.",
			},
		},
		required: ["board"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_sector_constituents");

// B9's macro-indicator-value / yield-curve tool defs.
TOOLS.push({
	name: "finance_macro_us",
	description:
		"美国宏观指标 (FRED): CPI, 核心CPI, PCE, 失业率, 非农, GDP, 联邦基金利率, 10Y/2Y 国债, M2, " +
		"PPI, 零售. 不传 indicator 返回全景, 传单项返回时间序列. Use for: 美国 宏观 通胀 就业 利率 US " +
		"macro inflation. Not for: 发布日历 → finance_economic_calendar; 中国 → " +
		"finance_macro_cn.",
	inputSchema: {
		type: "object",
		properties: {
			indicator: {
				type: "string",
				enum: [
					"cpi",
					"core_cpi",
					"pce",
					"unemployment",
					"nonfarm",
					"gdp",
					"real_gdp",
					"fed_funds",
					"cpi_yoy",
					"retail_sales",
					"ppi",
					"industrial",
					"m2",
					"treasury_10y",
					"treasury_2y",
				],
				description: "Macro indicator key. Omit for a dashboard of all.",
			},
			limit: {
				type: "number",
				description:
					"Number of most-recent observations (default 12, max 120).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_macro_us");

TOOLS.push({
	name: "finance_macro_cn",
	description:
		"中国宏观指标 (EastMoney): CPI, PPI, PMI, GDP, 货币供应 M0/M1/M2, 含同比/环比. Use " +
		"for: 中国 宏观 经济数据 通胀 China macro. Not for: 美国 → finance_macro_us.",
	inputSchema: {
		type: "object",
		properties: {
			indicator: {
				type: "string",
				enum: ["cpi", "ppi", "pmi", "gdp", "m2"],
				description: "Macro indicator key. Omit for a dashboard of all.",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_macro_cn");

TOOLS.push({
	name: "finance_yield_curve",
	description:
		"美债收益率曲线 (FRED): 1个月至30年期最新收益率. Use for: 国债 收益率 利率倒挂 期限利差 yield curve " +
		"inversion. Not for: 政策利率 fed funds → finance_macro_us.",
	inputSchema: {
		type: "object",
		properties: {},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_yield_curve");

// B11's news / stock-news tool defs.
TOOLS.push({
	name: "finance_news",
	description:
		"7x24 财经快讯. source=eastmoney (默认, 东财全球资讯) | cls (财联社电报, A股时效强, " +
		"独立信源互备). Use for: 快讯 新闻 电报 突发 实时资讯 breaking flash news. Not for: " +
		"个股新闻 → finance_stock_news; 全球行业新闻 → finance_industry_news.",
	inputSchema: {
		type: "object",
		properties: {
			limit: {
				type: "number",
				description: "Number of items (default 20, max 100).",
			},
			source: {
				type: "string",
				enum: ["eastmoney", "cls"],
				description: "News source (default eastmoney).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_news");

TOOLS.push({
	name: "finance_stock_news",
	description:
		"个股/关键词新闻搜索 (EastMoney, 中文公司名效果最好): 标题, 摘要, 来源, 日期, url. Use for: 公司 " +
		"最新消息 新闻 报道 利好 利空 company news. Not for: 全市场快讯 → finance_news; 公告原文 → " +
		"finance_announcements.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Company name or keyword, e.g. 浦发银行.",
			},
			limit: {
				type: "number",
				description: "Number of articles (default 10, max 50).",
			},
		},
		required: ["query"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_stock_news");
