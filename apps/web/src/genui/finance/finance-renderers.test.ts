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
