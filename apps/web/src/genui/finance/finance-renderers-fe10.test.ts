import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-10 slice: finance_sentiment_trending / finance_sentiment_ticker /
// finance_sentiment_market. Split out of finance-renderers.test.ts (which is
// at the project's 300-line-per-file cap) — same pattern as
// finance-renderers-fe9.test.ts.

const TRENDING_SENTIMENT_FIXTURE = {
	bearishPct: 22,
	buzzScore: 82,
	bullishPct: 61,
	mentions: 1500,
	name: "Tesla Inc",
	sentimentScore: 0.34,
	ticker: "TSLA",
	trend: "rising",
	uniquePosts: 420,
};

const TICKER_SENTIMENT_FIXTURE = {
	bearishPct: 30,
	buzzScore: 65,
	bullishPct: 48,
	dailyTrend: [
		{
			bearishPct: 33,
			buzzScore: 55,
			bullishPct: 45,
			date: "2026-07-01",
			mentions: 120,
			sentimentScore: 0.1,
		},
		{
			bearishPct: 30,
			buzzScore: 65,
			bullishPct: 48,
			date: "2026-07-02",
			mentions: 150,
			sentimentScore: 0.12,
		},
	],
	found: true,
	mentions: 900,
	name: "Apple Inc",
	negativeCount: 190,
	neutralCount: 400,
	periodDays: 7,
	positiveCount: 310,
	sentimentScore: 0.12,
	ticker: "AAPL",
	trend: "falling",
};

const MARKET_SENTIMENT_FIXTURE = {
	activeTickers: 320,
	bearishPct: 28,
	buzzScore: 58,
	bullishPct: 52,
	drivers: [
		{ buzzScore: 91, mentions: 3200, sentimentScore: 0.4, ticker: "NVDA" },
	],
	mentions: 45_000,
	negativeCount: 9000,
	neutralCount: 18_000,
	positiveCount: 18_000,
	sentimentScore: 0.08,
	trend: "bullish",
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_sentiment_trending fixture", () => {
	expect(
		financeTool("finance_sentiment_trending").parse([
			TRENDING_SENTIMENT_FIXTURE,
		])
	).not.toBeNull();
});

it("returns null for finance_sentiment_trending given a wrong shape", () => {
	expect(
		financeTool("finance_sentiment_trending").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_sentiment_ticker fixture", () => {
	expect(
		financeTool("finance_sentiment_ticker").parse(TICKER_SENTIMENT_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_sentiment_ticker given a wrong shape", () => {
	expect(
		financeTool("finance_sentiment_ticker").parse({ unrelated: "shape" })
	).toBeNull();
});

it("parses a representative finance_sentiment_market fixture", () => {
	expect(
		financeTool("finance_sentiment_market").parse(MARKET_SENTIMENT_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_sentiment_market given a wrong shape", () => {
	expect(
		financeTool("finance_sentiment_market").parse({ unrelated: "shape" })
	).toBeNull();
});
