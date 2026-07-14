import { expect, it } from "vitest";
import { computeMA, MA_COLORS, MA_CONFIGS } from "./candlestick-ma";
import type { CandleData } from "./finance-schemas";

// The highest-value test in the PriceChart port: computeMA is pure math with
// no chart-library or React weight, so it's asserted directly rather than
// through the mocked lightweight-charts canvas (see candlestick-chart.test.tsx
// for control-presence/empty-state coverage instead).

function candle(time: string, close: number): CandleData {
	return { close, high: close, low: close, open: close, time, volume: 0 };
}

const CLOSES = [1, 2, 3, 4, 5];
const CANDLES: CandleData[] = CLOSES.map((close, i) => candle(`d${i}`, close));

it("computes a trailing simple moving average, omitting the warm-up window", () => {
	const points = computeMA(CANDLES, 3);
	expect(points).toEqual([
		{ time: "d2", value: 2 },
		{ time: "d3", value: 3 },
		{ time: "d4", value: 4 },
	]);
});

it("a period of 1 echoes every close", () => {
	const points = computeMA(CANDLES, 1);
	expect(points.map((p) => p.value)).toEqual(CLOSES);
});

it("a period longer than the series produces no points (window never fills)", () => {
	expect(computeMA(CANDLES, CLOSES.length + 1)).toEqual([]);
});

it("a non-positive period returns an empty array", () => {
	expect(computeMA(CANDLES, 0)).toEqual([]);
	expect(computeMA(CANDLES, -1)).toEqual([]);
});

it("an empty candle series produces no points regardless of period", () => {
	expect(computeMA([], 5)).toEqual([]);
});

it("MA_CONFIGS is MA5/MA10/MA20 in that order", () => {
	expect(MA_CONFIGS.map((ma) => [ma.id, ma.period])).toEqual([
		["ma5", 5],
		["ma10", 10],
		["ma20", 20],
	]);
});

it("MA_COLORS assigns one distinct color per MA_CONFIGS entry", () => {
	expect(MA_COLORS).toHaveLength(MA_CONFIGS.length);
	expect(new Set(MA_COLORS).size).toBe(MA_CONFIGS.length);
});
