import { describe, expect, it } from "vitest";
import { annualizedVolPct, computeVolatility, logReturns } from "./volatility";

describe("logReturns", () => {
	it("computes log returns and skips non-positive prices", () => {
		const r = logReturns([100, 110, 0, 120]);
		expect(r).toHaveLength(1); // 100->110 only; the 0 breaks both adjacent pairs
		expect(r[0]).toBeCloseTo(Math.log(1.1), 6);
	});
});

describe("annualizedVolPct", () => {
	it("returns null for < 2 returns", () => {
		expect(annualizedVolPct([])).toBeNull();
		expect(annualizedVolPct([0.01])).toBeNull();
	});

	it("annualizes the sample stdev by sqrt(252) into a percent", () => {
		// returns with sample stdev 0.01 -> 0.01 * sqrt(252) * 100 ≈ 15.87
		const rs = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
		const hv = annualizedVolPct(rs) as number;
		expect(hv).toBeGreaterThan(15);
		expect(hv).toBeLessThan(18);
	});
});

describe("computeVolatility", () => {
	it("fills each window that has enough data and nulls the rest", () => {
		// 40 closes -> 39 returns: 20d HV available, 60/120/250 null.
		const closes = Array.from({ length: 40 }, (_, i) => 100 + (i % 2));
		const dates = closes.map(
			(_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`
		);
		const v = computeVolatility("510050.SH", closes, dates);
		expect(v?.hv["20"]).not.toBeNull();
		expect(v?.hv["60"]).toBeNull();
		expect(v?.hv["250"]).toBeNull();
		expect(v?.close).toBe(closes.at(-1));
		expect(v?.date).toBe(dates.at(-1));
	});

	it("returns null for a degenerate series", () => {
		expect(computeVolatility("x", [100], ["2026-07-15"])).toBeNull();
	});

	it("produces a 20d HV percentile once there is enough history", () => {
		// 60 closes -> plenty of rolling-20 windows for a percentile.
		const closes = Array.from(
			{ length: 60 },
			(_, i) => 100 + Math.sin(i / 3) * 5
		);
		const v = computeVolatility(
			"600519.SH",
			closes,
			closes.map((_, i) => `d${i}`)
		);
		expect(v?.hv20Percentile).not.toBeNull();
		expect(v?.hv20Percentile).toBeGreaterThanOrEqual(0);
		expect(v?.hv20Percentile).toBeLessThanOrEqual(100);
	});
});
