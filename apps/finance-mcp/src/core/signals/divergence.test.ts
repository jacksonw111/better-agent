import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "../fred/economic";
import { getDivergence } from "./divergence";

// getDivergence fans out to getKline (US day kline: resolves the
// exchange-suffixed code via qt.gtimg.cn, then fetches the kline itself from
// ifzq.gtimg.cn) AND sentimentTicker (api.adanos.org). fetchImplFor branches
// a single fetchImpl by URL across all three hosts.
const QUOTE_PAYLOAD = `v_usAAPL="200~Apple~AAPL.OQ~310.66~312.66~315.29~42490002~0~0~311.40~40~0~0~0~0~0~0~0~0~312.04~40~0~0~0~0~0~0~0~0~~2026-07-07 16:00:01~-2.00~-0.64~315.48~310.15~USD~";`;

function klineRaw(closes: number[]): unknown {
	const dates = [
		"2026-06-30",
		"2026-07-01",
		"2026-07-02",
		"2026-07-03",
		"2026-07-06",
		"2026-07-07",
	];
	return {
		code: 0,
		data: {
			"usAAPL.OQ": {
				day: closes.map((close, i) => [
					dates[i],
					String(close - 1),
					String(close),
					String(close + 1),
					String(close - 2),
					"1000000",
				]),
			},
		},
	};
}

function fetchImplFor(
	klinePayload: unknown,
	sentimentResponse: () => Promise<Response>
): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		if (href.includes("qt.gtimg.cn/q=")) {
			return Promise.resolve(
				new Response(new TextEncoder().encode(QUOTE_PAYLOAD))
			);
		}
		if (href.includes("ifzq.gtimg.cn")) {
			return Promise.resolve(Response.json(klinePayload));
		}
		if (href.includes("api.adanos.org")) {
			return sentimentResponse();
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

const BEARISH_SENTIMENT = {
	ticker: "AAPL",
	found: true,
	buzz_score: 80,
	mentions: 500,
	sentiment_score: -0.3,
	bullish_pct: 20,
	bearish_pct: 60,
};

const BULLISH_SENTIMENT = {
	ticker: "AAPL",
	found: true,
	buzz_score: 80,
	mentions: 500,
	sentiment_score: 0.3,
	bullish_pct: 65,
	bearish_pct: 15,
};

describe("getDivergence: config", () => {
	it("throws NotConfiguredError without an ADANOS_API_KEY", async () => {
		await expect(getDivergence("AAPL", "x", "")).rejects.toBeInstanceOf(
			NotConfiguredError
		);
	});
});

describe("getDivergence: 顶背离 (price up, sentiment bearish)", () => {
	it("flags 顶背离 when price rises 5d but sentiment is bearish", async () => {
		const fetchImpl = fetchImplFor(
			klineRaw([100, 101, 102, 103, 104, 108]),
			() => Promise.resolve(Response.json(BEARISH_SENTIMENT))
		);
		const result = await getDivergence("AAPL", "x", "KEY", { fetchImpl });
		expect(result).toMatchObject({
			ticker: "AAPL",
			priceTrend: "up",
			sentimentTrend: "bearish",
			signal: "顶背离",
		});
		expect(result?.priceChange5d).toBeGreaterThan(1);
		expect(result?.sentimentNet).toBeLessThan(-5);
		expect(typeof result?.note).toBe("string");
	});
});

describe("getDivergence: 底背离 (price down, sentiment bullish)", () => {
	it("flags 底背离 when price falls 5d but sentiment is bullish", async () => {
		const fetchImpl = fetchImplFor(
			klineRaw([110, 109, 108, 107, 106, 100]),
			() => Promise.resolve(Response.json(BULLISH_SENTIMENT))
		);
		const result = await getDivergence("AAPL", "x", "KEY", { fetchImpl });
		expect(result).toMatchObject({
			ticker: "AAPL",
			priceTrend: "down",
			sentimentTrend: "bullish",
			signal: "底背离",
		});
		expect(result?.priceChange5d).toBeLessThan(-1);
		expect(result?.sentimentNet).toBeGreaterThan(5);
	});
});

describe("getDivergence: 数据不足 (missing sentiment)", () => {
	it("returns a partial result with 数据不足 when sentiment is unavailable", async () => {
		const fetchImpl = fetchImplFor(
			klineRaw([100, 101, 102, 103, 104, 108]),
			() => Promise.resolve(new Response("boom", { status: 500 }))
		);
		const result = await getDivergence("AAPL", "x", "KEY", { fetchImpl });
		expect(result).not.toBeNull();
		expect(result?.signal).toBe("数据不足");
		expect(result?.priceTrend).toBe("up");
		expect(result?.sentimentTrend).toBeNull();
		expect(result?.bullishPct).toBeNull();
	});
});

describe("getDivergence: insufficient candles", () => {
	it("returns 数据不足 when fewer than 6 candles are available", async () => {
		// klineRaw([...]) with fewer than 6 closes produces fewer than
		// MIN_CANDLES rows.
		const fetchImpl = fetchImplFor(klineRaw([100, 101, 102]), () =>
			Promise.resolve(Response.json(BULLISH_SENTIMENT))
		);
		const result = await getDivergence("AAPL", "x", "KEY", { fetchImpl });
		expect(result?.priceTrend).toBeNull();
		expect(result?.signal).toBe("数据不足");
	});
});

describe("getDivergence: both inputs fail", () => {
	it("degrades to null when both price and sentiment are unavailable", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("qt.gtimg.cn/q=")) {
				return Promise.resolve(
					new Response(new TextEncoder().encode(QUOTE_PAYLOAD))
				);
			}
			return Promise.resolve(new Response("boom", { status: 500 }));
		}) as typeof fetch;
		const result = await getDivergence("AAPL", "x", "KEY", { fetchImpl });
		expect(result).toBeNull();
	});
});
