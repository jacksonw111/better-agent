import { z } from "zod";

// FE-10 slice: finance_sentiment_trending / finance_sentiment_ticker /
// finance_sentiment_market (sentiment-trending.tsx / sentiment-ticker.tsx /
// sentiment-market.tsx). Mirrors TrendingSentiment / TickerSentiment /
// DailySentiment / MarketSentiment / SentimentDriver in
// apps/finance-mcp/src/core/types-extra.ts — the Adanos market-sentiment API
// (Reddit/X/Polymarket/News buzz + sentiment). Split out as its own file —
// same pattern as finance-schemas-fe6/7/8/9.ts — since finance-schemas.ts is
// at the project's 300-line-per-file cap.

export const TrendingSentimentSchema = z.object({
	// Required discriminator: identifies this as a trending-sentiment row.
	ticker: z.string(),
	name: z.string().catch(""),
	buzzScore: z.number().catch(0),
	trend: z.string().catch(""),
	mentions: z.number().catch(0),
	sentimentScore: z.number().catch(0),
	bullishPct: z.number().catch(0),
	bearishPct: z.number().catch(0),
	uniquePosts: z.number().catch(0),
});

export type TrendingSentimentData = z.infer<typeof TrendingSentimentSchema>;

const DailySentimentSchema = z.object({
	date: z.string().catch(""),
	mentions: z.number().catch(0),
	sentimentScore: z.number().catch(0),
	buzzScore: z.number().catch(0),
	bullishPct: z.number().catch(0),
	bearishPct: z.number().catch(0),
});

export type DailySentimentData = z.infer<typeof DailySentimentSchema>;

export const TickerSentimentSchema = z.object({
	// Required discriminator: identifies this as a ticker-sentiment result.
	ticker: z.string(),
	name: z.string().catch(""),
	found: z.boolean().catch(true),
	buzzScore: z.number().catch(0),
	mentions: z.number().catch(0),
	sentimentScore: z.number().catch(0),
	bullishPct: z.number().catch(0),
	bearishPct: z.number().catch(0),
	positiveCount: z.number().catch(0),
	negativeCount: z.number().catch(0),
	neutralCount: z.number().catch(0),
	trend: z.string().catch(""),
	periodDays: z.number().catch(0),
	dailyTrend: z.array(DailySentimentSchema).catch([]),
});

export type TickerSentimentData = z.infer<typeof TickerSentimentSchema>;

const SentimentDriverSchema = z.object({
	ticker: z.string().catch(""),
	mentions: z.number().catch(0),
	buzzScore: z.number().catch(0),
	sentimentScore: z.number().catch(0),
});

export type SentimentDriverData = z.infer<typeof SentimentDriverSchema>;

export const MarketSentimentSchema = z.object({
	// Required discriminator: identifies this as a market-sentiment snapshot.
	buzzScore: z.number(),
	trend: z.string().catch(""),
	mentions: z.number().catch(0),
	sentimentScore: z.number().catch(0),
	bullishPct: z.number().catch(0),
	bearishPct: z.number().catch(0),
	activeTickers: z.number().catch(0),
	positiveCount: z.number().catch(0),
	negativeCount: z.number().catch(0),
	neutralCount: z.number().catch(0),
	drivers: z.array(SentimentDriverSchema).catch([]),
});

export type MarketSentimentData = z.infer<typeof MarketSentimentSchema>;
