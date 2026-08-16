import { TOOL_NAMES, TOOLS } from "./tool-defs";

// Split out of tool-defs.ts (which is at the project's 300-line-per-file
// cap): B8's search / research / earnings-forecast tool defs, registered on
// the same shared TOOLS/TOOL_NAMES arrays. Loaded via a side-effect import
// in mcp-server.ts, after tool-defs.ts has finished registering its own.

TOOLS.push({
	name: "finance_search",
	description:
		"股票搜索 (A股 EastMoney + 美股 Yahoo, 并行合并): 按名称/代码查 {code, name, exchange, market}. " +
		"不知道股票代码时的第一步工具; 美股命中含 EQUITY/ETF 类型. Use for: 查代码 股票叫什么 代码是多少 " +
		"搜索上市公司 ticker lookup 美股代码.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"Name or code to search, e.g. 茅台 / 600519 / apple / NVDA.",
			},
		},
		required: ["query"],
		additionalProperties: false,
	},
});
TOOL_NAMES.add("finance_search");

TOOLS.push({
	name: "finance_research",
	description:
		"A股个股券商研报: 机构, 标题, 评级, 未来三年 EPS/PE 预测, PDF 链接. Use for: 研报 券商报告 分析师 " +
		"目标价 评级 research. Not for: 一致预期汇总 → finance_earnings_forecast; 美股评级 → " +
		"finance_analyst_ratings.",
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
TOOL_NAMES.add("finance_research");

TOOLS.push({
	name: "finance_earnings_forecast",
	description:
		"A股机构一致预期: 今年/明年/后年 EPS 与 PE 共识 (聚合近期研报). Use for: 一致预期 盈利预测 未来业绩 " +
		"consensus estimate. Not for: 单篇研报 → finance_research; 业绩预告 → " +
		"finance_earnings_preannounce.",
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
TOOL_NAMES.add("finance_earnings_forecast");
