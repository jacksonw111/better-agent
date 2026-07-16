// Built-in skill manifest (QuantSkills integration, Phase 1). Each entry pairs
// stable metadata (name / description / allowedTools) with a sibling `.md` file
// holding the full instructions prose. seed-skills.ts loads the `.md` at deploy
// and upserts every entry via SkillStore.upsertBuiltin (idempotent by name).
//
// The instructions are original ports of the QuantSkills A-share methodology
// (workflow / report structure / risk rules) rewritten onto our finance_* MCP
// tools — no upstream code or text is copied. Data access is finance-mcp only.

export interface BuiltinSkillManifestEntry {
	/** finance_* tools the skill drives. Assumes finance-mcp is on the agent. */
	allowedTools: string[];
	/** Index-line shown always; includes when-to-use + `/name` activation hint. */
	description: string;
	/** Sibling markdown file (relative to this dir) holding the instructions. */
	file: string;
	/** Stable identity — never rename (agent assignments key on the seeded id). */
	name: string;
}

export const BUILTIN_SKILL_MANIFEST: BuiltinSkillManifestEntry[] = [
	{
		name: "market-review",
		description:
			"A股收盘复盘 — 指数与估值、市场宽度(涨跌家数/涨跌停/连板梯队)、行业概念热点、龙虎榜、大宗、两融、北向、资金流,产出可溯源的当日复盘报告。当用户提到 复盘/收盘总结/每日市场报告/A股复盘/龙虎榜复盘/北向动向 时使用。用 `/market-review` 激活。",
		allowedTools: [
			"finance_trade_calendar",
			"finance_market_breadth",
			"finance_index_quote",
			"finance_limit_up_pool",
			"finance_limit_up_reasons",
			"finance_limit_up_sentiment",
			"finance_strong_stocks",
			"finance_sector_list",
			"finance_sector_constituents",
			"finance_hot_concepts",
			"finance_dragon_tiger",
			"finance_block_trades",
			"finance_margin",
			"finance_hsgt_flow",
			"finance_money_flow",
			"finance_news",
		],
		file: "market-review.md",
	},
	{
		name: "stock-dossier",
		description:
			"A股个股尽调 — 输入一个代码,产出可溯源的中文尽调报告:基本面、分红资本运作、股东行为、质押解禁减持风险、资金面,一次查清。当用户提到 个股体检/个股尽调/公司全面分析/基本面报告/解禁减持风险排查 时使用。用 `/stock-dossier` 激活。",
		allowedTools: [
			"finance_search",
			"finance_company_profile",
			"finance_key_metrics",
			"finance_financial_statements",
			"finance_financial_indicators",
			"finance_dividends",
			"finance_top_holders",
			"finance_holder_count",
			"finance_insider_trades",
			"finance_lockup",
			"finance_share_pledge",
			"finance_dragon_tiger",
			"finance_block_trades",
			"finance_margin",
			"finance_money_flow",
			"finance_earnings_forecast",
			"finance_earnings_preannounce",
			"finance_research",
			"finance_suspension",
			"finance_convertible_bonds",
		],
		file: "stock-dossier.md",
	},
	{
		name: "macro-monitor",
		description:
			"宏观监控 — 中美 CPI/PPI/PMI/GDP/M2、美债收益率曲线、宏观发布日程、央行流动性、主要指数与商品、预测市场,产出宏观环境综述与状态研判。当用户提到 宏观/CPI/利率/降息/衰退/收益率曲线/宏观日历 时使用。用 `/macro-monitor` 激活。",
		allowedTools: [
			"finance_macro_cn",
			"finance_macro_us",
			"finance_yield_curve",
			"finance_economic_calendar",
			"finance_central_bank",
			"finance_index_quote",
			"finance_commodity",
			"finance_prediction_markets",
		],
		file: "macro-monitor.md",
	},
	{
		name: "earnings-season",
		description:
			"财报季扫描 — 业绩预告分布(预增/预减/首亏/扭亏)、超预期与暴雷清单、一致预期、行业景气、定期报告披露节奏,产出财报季追踪报告。当用户提到 财报季/业绩预告/预增预减/超预期/业绩暴雷/披露进度 时使用。用 `/earnings-season` 激活。",
		allowedTools: [
			"finance_trade_calendar",
			"finance_earnings_calendar",
			"finance_earnings_preannounce",
			"finance_earnings_forecast",
			"finance_financial_indicators",
			"finance_research",
			"finance_sector_list",
			"finance_list_reports",
		],
		file: "earnings-season.md",
	},
	{
		name: "smart-money",
		description:
			"主力资金画像 — 龙虎榜席位、北向持仓、主力资金流、十大股东与户数、大宗、两融,多源交叉判断主力共识或分歧,产出资金主力画像。当用户提到 主力资金/游资/机构席位/北向/龙虎榜席位/资金画像 时使用。用 `/smart-money` 激活。",
		allowedTools: [
			"finance_dragon_tiger",
			"finance_hsgt_flow",
			"finance_money_flow",
			"finance_top_holders",
			"finance_holder_count",
			"finance_block_trades",
			"finance_margin",
			"finance_cn_hot",
			"finance_strong_stocks",
			"finance_search",
		],
		file: "smart-money.md",
	},
	{
		name: "block-trade-radar",
		description:
			"大宗交易折溢价雷达 — 扫描当日/近期大宗交易,识别折价抛压与溢价接盘、机构专用席位、高频标的,产出大宗异动清单。当用户提到 大宗交易/折价/溢价/大宗抛压/机构接盘 时使用。用 `/block-trade-radar` 激活。",
		allowedTools: [
			"finance_block_trades",
			"finance_search",
			"finance_quote",
			"finance_company_profile",
			"finance_dragon_tiger",
			"finance_trade_calendar",
		],
		file: "block-trade-radar.md",
	},
	{
		name: "event-risk",
		description:
			"个股事件风险预警 — 对一只或一组股票扫描解禁、减持、停牌、业绩暴雷、可转债强赎、分红除权等日历型风险事件,按高/中/低分级产出预警清单。当用户提到 风险排查/解禁/减持/停牌/暴雷/风险预警/盯盘 时使用。用 `/event-risk` 激活。",
		allowedTools: [
			"finance_trade_calendar",
			"finance_search",
			"finance_lockup",
			"finance_share_pledge",
			"finance_insider_trades",
			"finance_suspension",
			"finance_earnings_preannounce",
			"finance_convertible_bonds",
			"finance_dividends",
			"finance_announcements",
			"finance_investor_qa",
		],
		file: "event-risk.md",
	},
	{
		name: "portfolio-checkup",
		description:
			"持仓组合体检 — 输入一篮子股票,产出集中度、行业暴露、加权估值、质量与技术面、资金面的组合健康报告与再平衡提示。当用户提到 组合体检/持仓分析/仓位/集中度/组合健康/再平衡 时使用。用 `/portfolio-checkup` 激活。",
		allowedTools: [
			"finance_search",
			"finance_key_metrics",
			"finance_financial_indicators",
			"finance_company_profile",
			"finance_quote",
			"finance_technical",
			"finance_money_flow",
			"finance_margin",
			"finance_sector_list",
			"finance_index_quote",
			"finance_index_valuation",
		],
		file: "portfolio-checkup.md",
	},
	{
		name: "fin-news",
		description:
			"财经资讯聚合撰稿 — 汇聚 7×24 快讯、个股/行业新闻、热榜与社媒情绪,按主题聚合、去重、排序,产出结构化的财经资讯综述或早晚报。当用户提到 资讯/快讯/新闻汇总/早报/晚报/热点梳理 时使用。用 `/fin-news` 激活。",
		allowedTools: [
			"finance_news",
			"finance_stock_news",
			"finance_industry_news",
			"finance_cn_hot",
			"finance_hot_list",
			"finance_hot_concepts",
			"finance_sentiment_trending",
			"finance_sentiment_market",
		],
		file: "fin-news.md",
	},
	{
		name: "index-rotation",
		description:
			"指数估值 + 行业轮动 — 宽基指数 PE/PB 估值分位(低估/高估研判)+ 行业/概念板块涨跌与资金轮动,判断当前该配哪些指数、哪些行业在轮动,产出配置与定投时机建议。当用户提到 指数估值/估值分位/现在贵不贵/定投时机/行业轮动/该买哪个指数/宽基配置 时使用。用 `/index-rotation` 激活。",
		allowedTools: [
			"finance_index_valuation",
			"finance_index_quote",
			"finance_sector_list",
			"finance_sector_constituents",
			"finance_hot_concepts",
			"finance_market_breadth",
			"finance_trade_calendar",
		],
		file: "index-rotation.md",
	},
	{
		name: "options-vol",
		description:
			"期权波动率分析 — 隐含波动率 IV vs 历史波动率 HV(波动率溢价:IV>HV=期权偏贵/卖方占优)、期限结构、波动率偏斜(skew)、希腊字母,覆盖 A 股 ETF 期权(50/300/500ETF)与美股期权。当用户提到 期权/隐波/IV/HV/波动率/期权贵不贵/卖方/期限结构/偏斜/希腊字母 时使用。用 `/options-vol` 激活。",
		allowedTools: [
			"finance_volatility",
			"finance_option_contracts",
			"finance_option_quote",
			"finance_us_options",
			"finance_option_chain",
			"finance_kline",
			"finance_search",
		],
		file: "options-vol.md",
	},
	{
		name: "us-insider",
		description:
			"美股内部人交易雷达 — 扫描某美股高管/董事/大股东的 SEC Form 4 申报,识别集中买入(看多信号)与大额抛售、CEO/CFO 等关键人动向,结合股价走势产出内部人动向研判。当用户提到 美股内部人/高管增减持/insider/Form4/内部人买卖/高管抛售 时使用。用 `/us-insider` 激活。",
		allowedTools: [
			"finance_us_insider",
			"finance_quote",
			"finance_kline",
			"finance_volatility",
		],
		file: "us-insider.md",
	},
];
