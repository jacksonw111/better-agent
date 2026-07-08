import { describe, expect, it } from "vitest";
import { getKline, parseKline, parseMinuteKline } from "./kline";

const RAW = {
	code: 0,
	data: {
		sh600000: {
			qfqday: [
				["2026-06-24", "9.260", "8.900", "9.270", "8.900", "1075266.000"],
				["2026-06-25", "8.850", "8.850", "8.930", "8.820", "658297.000"],
			],
		},
	},
};

describe("parseKline", () => {
	it("maps rows to candles with close before high/low", () => {
		const candles = parseKline(RAW, "sh600000", "day");
		expect(candles).toHaveLength(2);
		expect(candles[0]).toEqual({
			time: "2026-06-24",
			open: 9.26,
			close: 8.9,
			high: 9.27,
			low: 8.9,
			volume: 1_075_266,
		});
	});

	it("getKline fetches and parses", async () => {
		const fetchImpl = async () => Response.json(RAW);
		const candles = await getKline("600000.SH", "day", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(candles[1]?.time).toBe("2026-06-25");
	});

	it("slices to the caller's limit, keeping the LAST rows (tiny-limit fix)", async () => {
		const raw = {
			code: 0,
			data: {
				sh600000: {
					qfqday: [
						["2026-06-20", "9.100", "9.150", "9.200", "9.050", "100000.000"],
						["2026-06-21", "9.150", "9.200", "9.250", "9.100", "110000.000"],
						["2026-06-22", "9.200", "9.180", "9.220", "9.120", "120000.000"],
						["2026-06-23", "9.180", "9.220", "9.260", "9.150", "130000.000"],
						["2026-06-24", "9.260", "8.900", "9.270", "8.900", "1075266.000"],
					],
				},
			},
		};
		const fetchImpl = async () => Response.json(raw);
		const candles = await getKline("600000.SH", "day", 2, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(candles).toHaveLength(2);
		expect(candles[0]?.time).toBe("2026-06-23");
		expect(candles[1]?.time).toBe("2026-06-24");
	});
});

const MINUTE_RAW = {
	data: {
		sh600000: {
			m5: [
				["202607081500", "9.00", "9.00", "9.02", "8.99", "12940", {}, "0.39"],
			],
		},
	},
};

describe("parseMinuteKline", () => {
	it("maps mkline rows to candles with formatted intraday time", () => {
		const candles = parseMinuteKline(MINUTE_RAW, "sh600000", "5m");
		expect(candles).toHaveLength(1);
		expect(candles[0]).toEqual({
			time: "2026-07-08 15:00",
			open: 9,
			close: 9,
			high: 9.02,
			low: 8.99,
			volume: 12_940,
		});
	});

	it("getKline fetches and parses minute candles via the mkline endpoint", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(MINUTE_RAW));
		const candles = await getKline("600000.SH", "5m", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(candles).toHaveLength(1);
		expect(candles[0]?.time).toBe("2026-07-08 15:00");
	});
});
