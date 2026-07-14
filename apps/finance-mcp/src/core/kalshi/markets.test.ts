import { describe, expect, it } from "vitest";
import {
	getKalshiMarkets,
	type RawKalshiMarket,
	toKalshiMarket,
} from "./markets";

function rowFixture(overrides: Partial<RawKalshiMarket> = {}): RawKalshiMarket {
	return {
		ticker: "FED-26JUL-T4.50",
		event_ticker: "FED-26JUL",
		title: "Fed funds rate above 4.50% after July meeting?",
		yes_sub_title: "Above 4.50%",
		market_type: "binary",
		last_price_dollars: "0.63",
		previous_price_dollars: "0.60",
		yes_bid_dollars: "0.62",
		yes_ask_dollars: "0.64",
		volume_fp: "150000.00",
		volume_24h_fp: "12500.00",
		open_interest_fp: "98000.00",
		liquidity_dollars: "45000.12",
		close_time: "2026-07-29T18:00:00Z",
		...overrides,
	};
}

function marketsResponse(rows: RawKalshiMarket[]): Response {
	return Response.json({ markets: rows });
}

describe("toKalshiMarket", () => {
	it("parses dollar-string and fixed-point-string fields into numbers", () => {
		expect(toKalshiMarket(rowFixture())).toEqual({
			ticker: "FED-26JUL-T4.50",
			eventTicker: "FED-26JUL",
			title: "Fed funds rate above 4.50% after July meeting?",
			subtitle: "Above 4.50%",
			yesPrice: 0.63,
			prevPrice: 0.6,
			yesBid: 0.62,
			yesAsk: 0.64,
			volume: 150_000,
			volume24h: 12_500,
			openInterest: 98_000,
			liquidity: 45_000.12,
			closeTime: "2026-07-29T18:00:00Z",
		});
	});

	it("maps missing/malformed prices to null and volumes to 0", () => {
		const market = toKalshiMarket(
			rowFixture({
				last_price_dollars: undefined,
				yes_bid_dollars: "not-a-number",
				volume_24h_fp: undefined,
			})
		);
		expect(market.yesPrice).toBeNull();
		expect(market.yesBid).toBeNull();
		expect(market.volume24h).toBe(0);
	});
});

describe("getKalshiMarkets request URL", () => {
	it("requests open markets with limit=200 and no series param by default", async () => {
		let requested = "";
		const fetchImpl = (url: string | URL | Request) => {
			requested = String(url);
			return Promise.resolve(marketsResponse([]));
		};
		await getKalshiMarkets("", "", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(requested).toBe(
			"https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=open"
		);
	});

	it("appends series_ticker when a series is given", async () => {
		let requested = "";
		const fetchImpl = (url: string | URL | Request) => {
			requested = String(url);
			return Promise.resolve(marketsResponse([]));
		};
		await getKalshiMarkets("KXFED", "", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(requested).toContain("&series_ticker=KXFED");
	});
});

describe("getKalshiMarkets filter and sort", () => {
	it("filters case-insensitively on title and yes_sub_title", async () => {
		const fetchImpl = () =>
			Promise.resolve(
				marketsResponse([
					rowFixture({ ticker: "A", title: "Fed rate decision" }),
					rowFixture({
						ticker: "B",
						title: "Some event",
						yes_sub_title: "FED pivot",
					}),
					rowFixture({ ticker: "C", title: "Rain tomorrow" }),
				])
			);
		const markets = await getKalshiMarkets("", "fed", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets.map((m) => m.ticker)).toEqual(["A", "B"]);
	});

	it("sorts by volume24h desc client-side and slices to limit", async () => {
		const fetchImpl = () =>
			Promise.resolve(
				marketsResponse([
					rowFixture({ ticker: "LOW", volume_24h_fp: "10.00" }),
					rowFixture({ ticker: "TOP", volume_24h_fp: "300.00" }),
					rowFixture({ ticker: "MID", volume_24h_fp: "200.00" }),
				])
			);
		const markets = await getKalshiMarkets("", "", 2, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets.map((m) => m.ticker)).toEqual(["TOP", "MID"]);
	});
});

describe("getKalshiMarkets degradation", () => {
	it("degrades to [] on an upstream error status", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("nope", { status: 404 }));
		const markets = await getKalshiMarkets("", "", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets).toEqual([]);
	});

	it("degrades to [] when the markets field is missing", async () => {
		const fetchImpl = () => Promise.resolve(Response.json({}));
		const markets = await getKalshiMarkets("", "", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets).toEqual([]);
	});
});
