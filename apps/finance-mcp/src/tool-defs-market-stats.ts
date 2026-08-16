import { TOOL_NAMES, TOOLS } from "./tool-defs";

// Market-stats tool defs (QuantSkills integration Phase 0): A-share trading
// calendar + full-market breadth snapshot. Loaded via a side-effect import in
// mcp-server.ts, same pattern as tool-defs-limitup.ts.

TOOLS.push({
	name: "finance_trade_calendar",
	description:
		"A股交易日历 (derived from 上证综指 sh000001 daily kline): lastTradeDate 最近交易日, " +
		"isTodayTradingDay 今天是否开市, tradeDays 最近约40个交易日 (ascending). Use for: 最近交易日 " +
		"是否休市 今天开市吗 某日是否交易日 复盘取数日期 定时任务判交易日. Not for: 未来交易日前瞻 (尚未支持); " +
		"美股 → finance_us_trade_calendar.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_trade_calendar");

TOOLS.push({
	name: "finance_market_breadth",
	description:
		"A股全市场宽度快照: advancers/decliners/unchanged 涨/跌/平家数, distribution 涨跌幅分布桶, " +
		"limitUp/limitDown/breakBoard 涨停/跌停/炸板家数, maxHeight 最高连板, ladder 连板梯队, breakRatePct " +
		"炸板率. 涨跌家数为实时快照 (收盘后运行=当日复盘); 涨跌停/连板按 date 精确取历史. date=交易日 " +
		"YYYYMMDD, 缺省=最近交易日. Use for: 涨跌家数 市场宽度 赚钱效应 普涨普跌 涨跌停家数 情绪. Not for: " +
		"个股涨停明细 → finance_limit_up_pool; 板块涨跌 → finance_sector_list; 美股 → " +
		"finance_us_market_breadth.",
	inputSchema: {
		type: "object",
		properties: {
			date: {
				type: "string",
				description:
					"Trading day, YYYYMMDD, e.g. 20260714. Defaults to the last trading day.",
			},
		},
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_market_breadth");

TOOLS.push({
	name: "finance_share_pledge",
	description:
		"A股股权质押 (EastMoney/中登): 某只个股的质押比例%历史 (按结算日, 最新在前), 每行含 质押比例, 质押笔数, 质押市值(万元), 待购回余额, 行业. ⚠️中登披露有滞后, 最新一行可能落后市场较久——按返回 date 当作 as-of 日, 别当当前值. Use for: 股权质押 质押比例 质押风险 大股东质押 平仓风险. Not for: 解禁 → finance_lockup; 减持 → finance_insider_trades.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share symbol, e.g. 000002.SZ or 600519.SH.",
			},
			limit: {
				type: "number",
				description: "Max settlement-date rows (default 12, max 60).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_share_pledge");

TOOLS.push({
	name: "finance_index_valuation",
	description:
		"A股宽基指数估值分位 (乐咕乐股): 某指数当前 PE(TTM/静态) + PB 及其历史百分位 (0-100, 越低越便宜) + 估值研判(低估/偏低/合理/偏高/高估). symbol 支持: 沪深300 上证50 中证500 中证1000 中证800 中证100 上证180 上证380 创业板50 深证100 上证红利 深证红利 上证红利 (也接受 hs300/000300 等别名). Use for: 指数估值 估值分位 PE分位 PB分位 高估低估 现在贵不贵 定投时机. Not for: 个股估值 → finance_key_metrics; 指数点位 → finance_index_quote.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "Broad-based index name, e.g. 沪深300 / 中证500 / 上证50.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_index_valuation");

TOOLS.push({
	name: "finance_volatility",
	description:
		"历史/已实现波动率 HV (年化%, 由日K计算): 多窗口 20/60/120/250日 HV + 最新20日HV的一年历史分位(0-100,越高=波动越极端). 配合期权 IV(finance_option_quote/finance_us_options)看波动率溢价: IV>HV=期权偏贵(卖方占优), IV<HV=期权偏便宜. symbol 支持 A/港/美(有日K即可). Use for: 历史波动率 已实现波动率 HV IV对比 波动率溢价 期权贵不贵. Not for: 隐含波动率IV → finance_option_quote/finance_us_options.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description:
					"Symbol with a daily series: A股 600519.SH / ETF 510050.SH / 美股 AAPL / 港股 00700.HK.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_volatility");

TOOLS.push({
	name: "finance_us_trade_calendar",
	description:
		"美股交易日历 (derived from 标普500 daily kline): lastTradeDate 最近交易日 (美东 " +
		"YYYY-MM-DD), isTodayTradingDay 今天(美东)是否有交易, tradeDays 最近约40个交易日 (ascending). " +
		"Use for: 美股最近交易日 美股今天开市吗 美股休市 某日美股是否交易日. Not for: A股 → " +
		"finance_trade_calendar; 未来交易日前瞻 (尚未支持).",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_us_trade_calendar");

TOOLS.push({
	name: "finance_us_market_breadth",
	description:
		"美股全市场宽度快照 (NASDAQ+NYSE+AMEX ~7000只, Nasdaq screener): advancers/decliners/" +
		"unchanged 涨/跌/平家数, distribution 涨跌幅分布桶 (±3/5/7/10%, 美股无涨跌停), medianChangePct " +
		"中位涨跌幅. 实时快照 (美股收盘后运行=当日复盘), 不支持按历史日期取数. Use for: 美股涨跌家数 美股市场宽度 " +
		"美股普涨普跌 美股情绪. Not for: A股 → finance_market_breadth; 指数点位 → finance_index_quote.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_us_market_breadth");

TOOLS.push({
	name: "finance_m7",
	description:
		"美股七巨头 Magnificent 7 (AAPL MSFT GOOGL AMZN NVDA META TSLA) 一键快照: 每只 现价 涨跌幅 " +
		"市值 PE(TTM/forward) PB EPS 52周高低 距52周高点% 成交量 (按市值降序), 外加 totalMarketCap 合计市值, " +
		"capWeightedChangePct 市值加权涨跌幅, advancers/decliners. Use for: 七巨头 M7 七朵金花 Mag7 " +
		"美股科技巨头 大盘股风向. Not for: 单只深挖 → finance_key_metrics / finance_financial_indicators.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_m7");

TOOLS.push({
	name: "finance_us_insider",
	description:
		"美股内部人交易 (SEC Form 4, via OpenInsider): 某美股 ticker 的高管/董事/大股东申报交易, 每行含 申报日/交易日/内部人/职务/交易类型(P买入/S卖出)/价格/股数(带符号)/金额/持股变动%. side=buy/sell. Use for: 美股内部人 高管增减持 insider trading Form4 内部人买卖. Not for: A股增减持 → finance_insider_trades; 港股(暂无免费源). symbol 用纯代码如 AAPL/TSLA/NVDA.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "US ticker, e.g. AAPL / TSLA / NVDA.",
			},
			limit: {
				type: "number",
				description: "Max transactions (default 25, max 100).",
			},
			days: {
				type: "number",
				description: "Lookback window in days (default 365, max 1460).",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_us_insider");
