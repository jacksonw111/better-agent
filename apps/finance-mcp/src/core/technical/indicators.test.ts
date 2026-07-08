import { describe, expect, it } from "vitest";
import type { Candle } from "../types";
import {
	boll,
	computeTechnical,
	ema,
	getTechnical,
	kdj,
	macd,
	rsi,
	sma,
} from "./indicators";

function candle(time: string, close: number): Candle {
	return { time, open: close, close, high: close, low: close, volume: 0 };
}

function makeCandles(closes: number[]): Candle[] {
	return closes.map((close, i) =>
		candle(`2026-01-${String(i + 1).padStart(2, "0")}`, close)
	);
}

describe("sma", () => {
	it("averages the last n values", () => {
		expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
	});

	it("returns null when fewer than n values", () => {
		expect(sma([1, 2], 3)).toBeNull();
	});
});

describe("ema", () => {
	it("is stable on a constant series", () => {
		expect(ema([1, 1, 1, 1], 3)).toBe(1);
	});

	it("returns null for an empty series", () => {
		expect(ema([], 3)).toBeNull();
	});
});

describe("rsi", () => {
	it("is 100 for a strictly increasing series (avgLoss 0)", () => {
		const closes = Array.from({ length: 20 }, (_, i) => i + 1);
		const value = rsi(closes);
		expect(value).toBe(100);
		expect(Number.isFinite(value)).toBe(true);
	});

	it("is 0 for a strictly decreasing series (avgGain 0)", () => {
		const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
		const value = rsi(closes);
		expect(value).toBe(0);
		expect(Number.isFinite(value)).toBe(true);
	});

	it("returns null with fewer than 15 closes", () => {
		expect(rsi(Array.from({ length: 10 }, (_, i) => i))).toBeNull();
	});
});

describe("boll", () => {
	it("collapses to a single value on a constant series", () => {
		const closes = Array.from({ length: 20 }, () => 10);
		const bands = boll(closes);
		expect(bands).toEqual({ upper: 10, mid: 10, lower: 10 });
	});

	it("returns null with fewer than 20 closes", () => {
		expect(boll(Array.from({ length: 10 }, () => 10))).toBeNull();
	});
});

describe("kdj", () => {
	it("handles the zero-denominator (flat) case without NaN", () => {
		const flat = Array.from({ length: 15 }, () => 10);
		const value = kdj(flat, flat, flat);
		expect(value).not.toBeNull();
		expect(Number.isFinite(value?.k)).toBe(true);
		expect(Number.isFinite(value?.d)).toBe(true);
		expect(Number.isFinite(value?.j)).toBe(true);
	});

	it("returns null with fewer than 9 candles", () => {
		const short = Array.from({ length: 5 }, () => 10);
		expect(kdj(short, short, short)).toBeNull();
	});
});

describe("macd", () => {
	it("returns finite numbers for a long enough series", () => {
		const closes = Array.from({ length: 40 }, (_, i) => 10 + i * 0.1);
		const value = macd(closes);
		expect(value).not.toBeNull();
		expect(Number.isFinite(value?.dif)).toBe(true);
		expect(Number.isFinite(value?.dea)).toBe(true);
		expect(Number.isFinite(value?.macd)).toBe(true);
	});

	it("returns null when too short", () => {
		const closes = Array.from({ length: 10 }, (_, i) => 10 + i);
		expect(macd(closes)).toBeNull();
	});
});

describe("computeTechnical", () => {
	it("returns a fully populated, finite snapshot for a ~60-point series", () => {
		const closes = Array.from(
			{ length: 60 },
			(_, i) => 100 + Math.sin(i / 5) * 3 + i * 0.05
		);
		const candles = makeCandles(closes);
		const snapshot = computeTechnical(candles);

		expect(snapshot.close).toBe(closes.at(-1));
		expect(snapshot.asOf).toBe(candles.at(-1)?.time);
		for (const value of [
			snapshot.ma5,
			snapshot.ma10,
			snapshot.ma20,
			snapshot.ma60,
			snapshot.ema12,
			snapshot.ema26,
			snapshot.rsi14,
		]) {
			expect(value).not.toBeNull();
			expect(Number.isFinite(value)).toBe(true);
		}
		expect(snapshot.macd).not.toBeNull();
		expect(snapshot.kdj).not.toBeNull();
		expect(snapshot.boll).not.toBeNull();
	});

	it("nulls out long-window indicators on a 10-point series but keeps close/asOf", () => {
		const closes = Array.from({ length: 10 }, (_, i) => 10 + i);
		const candles = makeCandles(closes);
		const snapshot = computeTechnical(candles);

		expect(snapshot.close).toBe(closes.at(-1));
		expect(snapshot.asOf).toBe(candles.at(-1)?.time);
		expect(snapshot.ma20).toBeNull();
		expect(snapshot.ma60).toBeNull();
		expect(snapshot.boll).toBeNull();
	});
});

describe("getTechnical", () => {
	const rows = Array.from({ length: 40 }, (_, i) => [
		`2026-01-${String(i + 1).padStart(2, "0")}`,
		String(10 + i * 0.1),
		String(10 + i * 0.1),
		String(10 + i * 0.1 + 0.2),
		String(10 + i * 0.1 - 0.2),
		"100000.000",
	]);
	const raw = {
		code: 0,
		data: { sh600000: { qfqday: rows } },
	};

	it("computes a snapshot from an injected fetchImpl matching the last candle", async () => {
		const fetchImpl = async () => Response.json(raw);
		const snapshot = await getTechnical("600000.SH", "day", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(snapshot).not.toBeNull();
		expect(snapshot?.close).toBeCloseTo(10 + 39 * 0.1);
		expect(snapshot?.asOf).toBe("2026-01-40");
		expect(snapshot?.symbol).toBe("600000.SH");
		expect(snapshot?.period).toBe("day");
	});

	it("returns null when there is not enough history", async () => {
		const sparse = {
			code: 0,
			data: { sh600000: { qfqday: rows.slice(0, 5) } },
		};
		const fetchImpl = async () => Response.json(sparse);
		const snapshot = await getTechnical("600000.SH", "day", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(snapshot).toBeNull();
	});
});
