import { TOOL_NAMES, TOOLS } from "./tool-defs";

// A股扩展 tool defs, ported from the a-stock-data skill: 巨潮公告 + 个股板块
// 归属 + 新浪 ETF 期权 (T型报价/希腊字母/IV). Loaded via a side-effect import
// in mcp-server.ts, same pattern as tool-defs-signals.ts.

TOOLS.push({
	name: "finance_announcements",
	description:
		"A股公告全文检索 (巨潮资讯 cninfo, EastMoney fallback): title, type, date, " +
		"detail url + PDF link. Optional keyword search within the stock's filings.",
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
		"A股个股所属板块/概念归属 (EastMoney): all industry/concept/region boards " +
		"one stock belongs to, with BK code, board change% and 龙头股. 题材归因必备.",
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
		"A股 ETF 期权合约清单 (新浪): contract codes grouped by expiry month " +
		"(first key = near month). Underlyings: 50ETF/300ETF/科创50ETF/500ETF. " +
		"Feed codes into finance_option_quote.",
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
		"A股 ETF 期权单合约详情 (新浪): T型报价 (买卖五档一档/持仓量/涨跌停) + " +
		"希腊字母 Delta/Gamma/Theta/Vega + 隐含波动率 IV + 理论价值. " +
		"Complements finance_option_chain (which has no Greeks).",
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
