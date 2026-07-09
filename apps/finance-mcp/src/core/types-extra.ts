// V3 batch: types for the free A-share tools (dividends, dragon-tiger, top
// holders). Split out of types.ts (which is at the project's
// 300-line-per-file cap) — same pattern as tool-defs-market.ts /
// tools-impl-market.ts splitting out of their base files.

export interface DividendRow {
	bonusRatioDividend: number | null;
	bonusRatioTransfer: number | null;
	exDividendDate: string;
	noticeDate: string;
	plan: string;
	pretaxDividendRmb: number | null;
	progress: string;
	recordDate: string;
	reportDate: string;
}

export interface DragonTigerRow {
	billboardAmount: number | null;
	changePct: number | null;
	close: number | null;
	code: string;
	name: string;
	reason: string;
	tradeDate: string;
	turnoverRate: number | null;
}

export interface HolderRow {
	changeRatio: number | null;
	changeShares: number | null;
	endDate: string;
	freeFloatRatio: number | null;
	holder: string;
	isInstitution: boolean;
	rank: number | null;
	shares: number | null;
}

export interface PredictionOutcome {
	name: string;
	probability: number;
}

export interface PredictionMarket {
	endDate: string;
	id: string;
	liquidityUsd: number;
	outcomes: PredictionOutcome[];
	question: string;
	slug: string;
	volumeUsd: number;
}

// Adanos market-sentiment API (Reddit/X/Polymarket/News buzz + sentiment).
export interface DailySentiment {
	bearishPct: number;
	bullishPct: number;
	buzzScore: number;
	date: string;
	mentions: number;
	sentimentScore: number;
}

export interface TrendingSentiment {
	bearishPct: number;
	bullishPct: number;
	buzzScore: number;
	mentions: number;
	name: string;
	sentimentScore: number;
	ticker: string;
	trend: string;
	uniquePosts: number;
}

export interface TickerSentiment {
	bearishPct: number;
	bullishPct: number;
	buzzScore: number;
	dailyTrend: DailySentiment[];
	found: boolean;
	mentions: number;
	name: string;
	negativeCount: number;
	neutralCount: number;
	periodDays: number;
	positiveCount: number;
	sentimentScore: number;
	ticker: string;
	trend: string;
}

export interface SentimentDriver {
	buzzScore: number;
	mentions: number;
	sentimentScore: number;
	ticker: string;
}

export interface MarketSentiment {
	activeTickers: number;
	bearishPct: number;
	bullishPct: number;
	buzzScore: number;
	drivers: SentimentDriver[];
	mentions: number;
	negativeCount: number;
	neutralCount: number;
	positiveCount: number;
	sentimentScore: number;
	trend: string;
}
