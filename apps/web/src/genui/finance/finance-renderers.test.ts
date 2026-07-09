import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

const INDEX_FIXTURE = {
	changePct: 0.42,
	code: "000001",
	high: 3210.5,
	last: 3200.12,
	low: 3180.3,
	name: "上证指数",
	prevClose: 3186.7,
	region: "CN",
};

const COMMODITY_FIXTURE = {
	changePct: -1.1,
	high: 2415.0,
	key: "XAU",
	last: 2400.5,
	low: 2390.0,
	name: "黄金",
	prevClose: 2427.2,
	time: "2026-07-08T09:30:00.000Z",
};

const QUOTE_FIXTURE = {
	asks: [
		{ price: 3201.5, volume: 1200 },
		{ price: 3201.8, volume: 800 },
	],
	bids: [
		{ price: 3201.2, volume: 1500 },
		{ price: 3200.9, volume: 600 },
	],
	changePct: 0.42,
	high: 3210.5,
	last: 3200.12,
	low: 3180.3,
	market: "a",
	name: "贵州茅台",
	open: 3190.0,
	prevClose: 3186.7,
	symbol: "600519",
	time: "2026-07-08T09:30:00.000Z",
	volume: 1_234_567,
};

const TECHNICAL_FIXTURE = {
	asOf: "2026-07-08",
	boll: { lower: 3150.2, mid: 3190.5, upper: 3230.8 },
	close: 3200.12,
	ema12: 3195.4,
	ema26: 3188.1,
	kdj: { d: 60.2, j: 75.1, k: 65.4 },
	ma5: 3198.1,
	ma10: 3192.4,
	ma20: 3180.9,
	ma60: 3150.2,
	macd: { dea: 5.2, dif: 6.1, macd: 1.8 },
	period: "daily",
	rsi14: 58.3,
	symbol: "600519",
};

const CANDLE_FIXTURE = [
	{
		close: 3205.4,
		high: 3212.1,
		low: 3190.0,
		open: 3195.2,
		time: "2026-07-06",
		volume: 128_400_000,
	},
	{
		close: 3198.7,
		high: 3208.9,
		low: 3192.3,
		open: 3205.4,
		time: "2026-07-07",
		volume: 141_200_000,
	},
];

const KEY_METRICS_FIXTURE = {
	changePct: 0.42,
	close: 1680.5,
	floatMarketCap: 2_100_000_000_000,
	floatShares: 1_250_000_000,
	marketCap: 2_110_000_000_000,
	pb: 8.9,
	pcf: 24.1,
	peg: 1.8,
	peStatic: 28.4,
	peTtm: 26.7,
	ps: 12.3,
	symbol: "600519.SH",
	totalShares: 1_256_000_000,
	tradeDate: "2026-07-08",
};

const COMPANY_PROFILE_FIXTURE = {
	address: "贵州省仁怀市茅台镇",
	businessScope: "食品、饮料生产销售",
	chairman: "丁雄军",
	csrcIndustry: "酒、饮料和精制茶制造业",
	employees: 41_000,
	foundDate: "1951-01-01",
	industry: "白酒",
	listingDate: "2001-08-27",
	market: "上海证券交易所",
	name: "贵州茅台",
	profile: "公司主要从事茅台酒及系列酒的生产与销售。",
	regCapital: 1_256_000_000,
};

const INDICATOR_ROW_FIXTURE = {
	bps: 195.3,
	debtRatio: 18.2,
	eps: 68.5,
	grossMargin: 91.9,
	netMargin: 52.3,
	netProfit: 86_000_000_000,
	netProfitYoy: 15.2,
	opCashPerShare: 72.4,
	reportDate: "2025-12-31",
	reportName: "2025年年报",
	revenue: 170_000_000_000,
	revenueYoy: 16.1,
	roe: 34.6,
	roeDeducted: 34.1,
};

const STATEMENT_ROW_FIXTURE = {
	netProfit: 86_000_000_000,
	netProfitDeducted: 85_000_000_000,
	operatingCost: 15_000_000_000,
	operatingProfit: 120_000_000_000,
	reportDate: "2025-12-31",
	revenue: 170_000_000_000,
	totalProfit: 121_000_000_000,
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_index_quote fixture", () => {
	expect(
		financeTool("finance_index_quote").parse([INDEX_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_index_quote given a wrong shape", () => {
	expect(
		financeTool("finance_index_quote").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_commodity fixture", () => {
	expect(
		financeTool("finance_commodity").parse([COMMODITY_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_commodity given a wrong shape", () => {
	expect(
		financeTool("finance_commodity").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_quote fixture", () => {
	expect(financeTool("finance_quote").parse(QUOTE_FIXTURE)).not.toBeNull();
});

it("returns null for finance_quote given a wrong shape", () => {
	expect(financeTool("finance_quote").parse({ unrelated: "shape" })).toBeNull();
});

it("parses a representative finance_technical fixture", () => {
	expect(
		financeTool("finance_technical").parse(TECHNICAL_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_technical given a wrong shape", () => {
	expect(
		financeTool("finance_technical").parse({ unrelated: "shape" })
	).toBeNull();
});

it("parses a representative finance_kline fixture", () => {
	expect(financeTool("finance_kline").parse(CANDLE_FIXTURE)).not.toBeNull();
});

it("returns null for finance_kline given a wrong shape", () => {
	expect(
		financeTool("finance_kline").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_key_metrics fixture", () => {
	expect(
		financeTool("finance_key_metrics").parse(KEY_METRICS_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_key_metrics given a wrong shape", () => {
	expect(
		financeTool("finance_key_metrics").parse({ unrelated: "shape" })
	).toBeNull();
});

it("parses a representative finance_company_profile fixture", () => {
	expect(
		financeTool("finance_company_profile").parse(COMPANY_PROFILE_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_company_profile given a wrong shape", () => {
	expect(
		financeTool("finance_company_profile").parse({ unrelated: "shape" })
	).toBeNull();
});

it("parses a representative finance_financial_indicators fixture", () => {
	expect(
		financeTool("finance_financial_indicators").parse([INDICATOR_ROW_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_financial_indicators given a wrong shape", () => {
	expect(
		financeTool("finance_financial_indicators").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_financial_statements fixture", () => {
	expect(
		financeTool("finance_financial_statements").parse([STATEMENT_ROW_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_financial_statements given a wrong shape", () => {
	expect(
		financeTool("finance_financial_statements").parse([{ unrelated: "shape" }])
	).toBeNull();
});
