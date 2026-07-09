import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "../fred/economic";
import { sentimentCompare } from "./compare";

const COMPARE_PAYLOAD = {
	period_days: 7,
	stocks: [
		{
			ticker: "AAPL",
			company_name: "Apple Inc.",
			buzz_score: 87.5,
			trend: "rising",
			mentions: 1200,
			sentiment_score: 0.42,
			bullish_pct: 61,
			bearish_pct: 22,
			unique_tweets: 340,
		},
		{
			ticker: "MSFT",
			company_name: "Microsoft Corp.",
			buzz_score: 55,
			trend: "flat",
			mentions: 400,
			sentiment_score: 0.05,
			bullish_pct: 40,
			bearish_pct: 35,
			unique_posts: 90,
		},
	],
};

describe("sentimentCompare: config", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(
			sentimentCompare(["AAPL", "MSFT"], "x", "stocks", "")
		).rejects.toBeInstanceOf(NotConfiguredError);
	});
});

describe("sentimentCompare: normalization", () => {
	it("maps stocks[] into TrendingSentiment[], preferring unique_tweets", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.adanos.org/x/stocks/v1/compare?tickers=AAPL,MSFT"
			);
			return Promise.resolve(Response.json(COMPARE_PAYLOAD));
		};
		const rows = await sentimentCompare(
			["aapl", "msft"],
			"x",
			"stocks",
			"KEY",
			{
				fetchImpl: fetchImpl as typeof fetch,
			}
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			ticker: "AAPL",
			name: "Apple Inc.",
			buzzScore: 87.5,
			uniquePosts: 340,
		});
		expect(rows[1]).toMatchObject({
			ticker: "MSFT",
			name: "Microsoft Corp.",
			uniquePosts: 90,
		});
	});

	it("defaults source to x and asset to stocks when omitted", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.adanos.org/x/stocks/v1/compare?tickers=AAPL"
			);
			return Promise.resolve(Response.json({ stocks: [] }));
		};
		await sentimentCompare(["AAPL"], undefined, undefined, "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});

	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("boom", { status: 500 }));
		const rows = await sentimentCompare(["AAPL"], "x", "stocks", "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});
