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

// NOTE: fetchImpl stubs encode with UTF-8 (TextEncoder), but the resolver
// decodes with TextDecoder("gbk"). That garbles multibyte (Chinese)
// characters while leaving ASCII fields (the exchange-suffixed code) intact —
// mirrors the pattern in quote.test.ts. Assertions below stick to
// ASCII-safe fields (resolved code / candle count), never Chinese text.
const US_QUOTE_PAYLOAD = `v_usAAPL="200~Apple~AAPL.OQ~310.66~312.66~315.29~42490002~0~0~311.40~40~0~0~0~0~0~0~0~0~312.04~40~0~0~0~0~0~0~0~0~~2026-07-07 16:00:01~-2.00~-0.64~315.48~310.15~USD~";`;

const US_DAY_KLINE_RAW = {
	code: 0,
	data: {
		"usAAPL.OQ": {
			day: [
				["2026-07-01", "310.00", "311.00", "312.00", "309.00", "1000000"],
				["2026-07-02", "311.00", "312.00", "313.00", "310.00", "1100000"],
				["2026-07-03", "312.00", "313.00", "314.00", "311.00", "1200000"],
			],
		},
	},
};

const US_MINUTE_KLINE_RAW = {
	data: {
		"usAAPL.OQ": {
			m5: [
				[
					"202607081500",
					"310.00",
					"311.00",
					"312.00",
					"309.00",
					"5000",
					{},
					"0.1",
				],
			],
		},
	},
};

// Builds a fetchImpl that serves the US quote payload for `qt.gtimg.cn/q=`
// requests (used to resolve the exchange suffix) and `otherPayload` for
// everything else, recording the non-quote URL via `captureUrl`.
function usQuoteThenFetchImpl(
	otherPayload: unknown,
	captureUrl: (url: string) => void
): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		if (href.includes("qt.gtimg.cn/q=")) {
			return Promise.resolve(
				new Response(new TextEncoder().encode(US_QUOTE_PAYLOAD))
			);
		}
		captureUrl(href);
		return Promise.resolve(Response.json(otherPayload));
	}) as typeof fetch;
}

describe("getKline: US day kline resolves the exchange-suffixed code", () => {
	it("fetches the quote, resolves usAAPL.OQ, and returns the full series", async () => {
		let klineUrl = "";
		const candles = await getKline("AAPL", "day", 30, {
			fetchImpl: usQuoteThenFetchImpl(US_DAY_KLINE_RAW, (u) => {
				klineUrl = u;
			}),
		});
		expect(candles).toHaveLength(3);
		expect(candles.at(-1)).toMatchObject({ time: "2026-07-03", close: 313 });
		expect(klineUrl).toContain("usAAPL.OQ");
	});
});

describe("getKline: A-share is unaffected by the US code resolver", () => {
	it("does NOT call the quote resolver for A-share symbols", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("qt.gtimg.cn/q=")) {
				throw new Error("quote resolver must not be called for A-share");
			}
			return Promise.resolve(Response.json(RAW));
		};
		const candles = await getKline("600000.SH", "day", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(candles).toHaveLength(2);
	});
});

describe("getKline: US minute kline resolves the exchange-suffixed code", () => {
	it("resolves usAAPL.OQ and hits the mkline endpoint with it", async () => {
		let mklineUrl = "";
		const candles = await getKline("AAPL", "5m", 10, {
			fetchImpl: usQuoteThenFetchImpl(US_MINUTE_KLINE_RAW, (u) => {
				mklineUrl = u;
			}),
		});
		expect(candles).toHaveLength(1);
		expect(mklineUrl).toContain("usAAPL.OQ");
	});
});
