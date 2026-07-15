import { TOOL_NAMES, TOOLS } from "./tool-defs";

// A股扩展 tool defs, ported from the a-stock-data skill: 巨潮公告 + 个股板块
// 归属 + 新浪 ETF 期权 (T型报价/希腊字母/IV). Loaded via a side-effect import
// in mcp-server.ts, same pattern as tool-defs-signals.ts.

TOOLS.push({
	name: "finance_announcements",
	description:
		"A股上市公司公告全文检索 (巨潮主源, 东财备胎): 标题, 类型, 日期, 详情页 + PDF 直链; search " +
		"关键词过滤 (如 回购/减持/中标). Use for: 公司公告 披露 澄清 公告原文 announcement " +
		"filing. Not for: 定期财报列表 → finance_list_reports; 互动问答 → finance_investor_qa.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 000858.SZ.",
			},
			limit: {
				type: "number",
				description: "Number of announcements (default 20, max 50).",
			},
			search: {
				type: "string",
				description: "Optional keyword filter, e.g. 回购 / 减持.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_announcements");

TOOLS.push({
	name: "finance_stock_boards",
	description:
		"A股个股板块归属 (EastMoney): 所属全部行业/概念/地域板块 + BK码 + 板块当日涨跌 + 龙头股. Use for: " +
		"属于什么板块 什么概念 行业归属 题材归因. Not for: 当下炒作命中 → finance_hot_concepts; 板块行情榜 " +
		"→ finance_sector_list.",
	inputSchema: {
		type: "object",
		properties: {
			symbol: {
				type: "string",
				description: "A-share ticker, e.g. 600519.SH / 002594.SZ.",
			},
		},
		required: ["symbol"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_stock_boards");

TOOLS.push({
	name: "finance_option_contracts",
	description:
		"A股 ETF 期权合约代码清单 (新浪), 按到期月分组 (首个 key=近月). underlying=510050 50ETF | " +
		"510300 300ETF | 588000 科创50 | 510500 500ETF; kind=call 认购 | put 认沽. " +
		"Use for: 期权合约 合约代码 到期月份. 下一步: 代码传给 finance_option_quote 取报价与希腊字母.",
	inputSchema: {
		type: "object",
		properties: {
			underlying: {
				type: "string",
				enum: ["510050", "510300", "588000", "510500"],
				description:
					"ETF code: 510050=50ETF (default), 510300=300ETF, 588000=科创50ETF, 510500=500ETF.",
			},
			kind: {
				type: "string",
				enum: ["call", "put"],
				description: "认购 (call, default) or 认沽 (put).",
			},
		},
		required: [],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_option_contracts");

TOOLS.push({
	name: "finance_option_quote",
	description:
		"A股 ETF 期权单合约详情 (新浪): T型报价 (买卖价/持仓量/涨跌停) + 希腊字母 Delta Gamma Theta " +
		"Vega + 隐含波动率 IV + 理论价值. code=8位合约代码 (来自 finance_option_contracts / " +
		"finance_option_chain). Use for: 期权 希腊字母 隐波 greeks iv delta. Not for: " +
		"美股期权 → finance_us_options.",
	inputSchema: {
		type: "object",
		properties: {
			code: {
				type: "string",
				description:
					"8-digit exchange contract code, e.g. 10011799 (from finance_option_contracts or finance_option_chain).",
			},
		},
		required: ["code"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_option_quote");
