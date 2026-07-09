import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "../fred/economic";
import {
	sentimentMarket,
	sentimentTicker,
	sentimentTrending,
} from "./sentiment";

const TRENDING_PAYLOAD = [
	{
		ticker: "AAPL",
		company_name: "Apple Inc.",
		buzz_score: 87.5,
		trend: "rising",
		mentions: 1200,
		sentiment_score: 0.42,
		bullish_pct: 61,
		bearish_pct: 22,
		unique_posts: 340,
	},
	{
		ticker: "TSLA",
		company_name: "Tesla Inc.",
		buzz_score: null,
		trend: "falling",
		mentions: 900,
		sentiment_score: -0.1,
		bullish_pct: 30,
		bearish_pct: 55,
		unique_posts: 210,
	},
];

describe("sentimentTrending: config + normalization", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(
			sentimentTrending("reddit", "stocks", 10, "")
		).rejects.toBeInstanceOf(NotConfiguredError);
	});

	it("maps a trending array response, defaulting NaN numbers to 0", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(TRENDING_PAYLOAD));
		const rows = await sentimentTrending("reddit", "stocks", 10, "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			ticker: "AAPL",
			name: "Apple Inc.",
			buzzScore: 87.5,
			trend: "rising",
			mentions: 1200,
			sentimentScore: 0.42,
			bullishPct: 61,
			bearishPct: 22,
			uniquePosts: 340,
		});
		expect(rows[1]?.buzzScore).toBe(0);
	});

	it("hits the trending URL with source/asset/limit", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.adanos.org/x/crypto/v1/trending?limit=5"
			);
			return Promise.resolve(Response.json([]));
		};
		await sentimentTrending("x", "crypto", 5, "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});

	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("boom", { status: 500 }));
		const rows = await sentimentTrending("reddit", "stocks", 10, "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});

const TICKER_PAYLOAD = {
	ticker: "AAPL",
	company_name: "Apple Inc.",
	found: true,
	buzz_score: 90,
	mentions: 500,
	sentiment_score: 0.3,
	bullish_pct: 60,
	bearish_pct: 20,
	positive_count: 300,
	negative_count: 100,
	neutral_count: 100,
	trend: "rising",
	period_days: 7,
	daily_trend: [
		{
			date: "2026-07-07",
			mentions: 80,
			sentiment_score: 0.2,
			buzz_score: 70,
			bullish_pct: 55,
			bearish_pct: 25,
		},
	],
};

describe("sentimentTicker: config", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(
			sentimentTicker("AAPL", "reddit", "stocks", "")
		).rejects.toBeInstanceOf(NotConfiguredError);
	});
});

describe("sentimentTicker: stocks", () => {
	it("maps an object response incl. dailyTrend, upper-casing the ticker", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.adanos.org/reddit/stocks/v1/stock/AAPL"
			);
			return Promise.resolve(Response.json(TICKER_PAYLOAD));
		};
		const result = await sentimentTicker("aapl", "reddit", "stocks", "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toMatchObject({
			ticker: "AAPL",
			name: "Apple Inc.",
			found: true,
			buzzScore: 90,
			mentions: 500,
			sentimentScore: 0.3,
			bullishPct: 60,
			bearishPct: 20,
			positiveCount: 300,
			negativeCount: 100,
			neutralCount: 100,
			trend: "rising",
			periodDays: 7,
		});
		expect(result?.dailyTrend).toEqual([
			{
				date: "2026-07-07",
				mentions: 80,
				sentimentScore: 0.2,
				buzzScore: 70,
				bullishPct: 55,
				bearishPct: 25,
			},
		]);
	});

	it("returns null on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("boom", { status: 500 }));
		const result = await sentimentTicker("AAPL", "reddit", "stocks", "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toBeNull();
	});
});

describe("sentimentTicker: crypto", () => {
	it("uses the token/{symbol} path for crypto", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe("https://api.adanos.org/x/crypto/v1/token/BTC");
			return Promise.resolve(
				Response.json({ ...TICKER_PAYLOAD, ticker: "BTC" })
			);
		};
		const result = await sentimentTicker("btc", "x", "crypto", "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result?.ticker).toBe("BTC");
	});
});

const MARKET_PAYLOAD = {
	buzz_score: 75,
	trend: "bullish",
	mentions: 5000,
	sentiment_score: 0.25,
	bullish_pct: 58,
	bearish_pct: 30,
	active_tickers: 120,
	positive_count: 2900,
	negative_count: 1500,
	neutral_count: 600,
	drivers: [
		{ ticker: "AAPL", mentions: 400, buzz_score: 88, sentiment_score: 0.4 },
	],
};

describe("sentimentMarket: normalization", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(
			sentimentMarket("reddit", "stocks", "")
		).rejects.toBeInstanceOf(NotConfiguredError);
	});

	it("maps a market-sentiment object incl. drivers", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.adanos.org/reddit/stocks/v1/market-sentiment"
			);
			return Promise.resolve(Response.json(MARKET_PAYLOAD));
		};
		const result = await sentimentMarket("reddit", "stocks", "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toMatchObject({
			buzzScore: 75,
			trend: "bullish",
			mentions: 5000,
			sentimentScore: 0.25,
			bullishPct: 58,
			bearishPct: 30,
			activeTickers: 120,
			positiveCount: 2900,
			negativeCount: 1500,
			neutralCount: 600,
		});
		expect(result?.drivers).toEqual([
			{ ticker: "AAPL", mentions: 400, buzzScore: 88, sentimentScore: 0.4 },
		]);
	});

	it("returns null on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("boom", { status: 500 }));
		const result = await sentimentMarket("reddit", "stocks", "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toBeNull();
	});
});

describe("source/asset defaulting", () => {
	it("defaults an invalid source to reddit and invalid asset to stocks", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.adanos.org/reddit/stocks/v1/trending?limit=10"
			);
			return Promise.resolve(Response.json([]));
		};
		await sentimentTrending("bogus", "bogus", 10, "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});

	it("news + crypto degrades to news + stocks", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.adanos.org/news/stocks/v1/market-sentiment"
			);
			return Promise.resolve(Response.json(MARKET_PAYLOAD));
		};
		await sentimentMarket("news", "crypto", "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
