// Adanos market-sentiment API: aggregated Reddit / X / Polymarket / News
// buzz + sentiment for stocks & crypto. Auth via `X-API-Key` header (a
// Worker secret). Verified live during research. Path pattern:
// `/{source}/{asset}/v1/{endpoint}`.

import { NotConfiguredError } from "../fred/economic";
import { fetchWithRetry } from "../http";
import type {
	DailySentiment,
	MarketSentiment,
	SentimentDriver,
	TickerSentiment,
	TrendingSentiment,
} from "../types-extra";

const BASE_URL = "https://api.adanos.org";
const DEFAULT_TRENDING_LIMIT = 10;
const MAX_TRENDING_LIMIT = 50;

export type SentimentSource = "reddit" | "x" | "polymarket" | "news";
export type SentimentAsset = "stocks" | "crypto";

const SOURCES: ReadonlySet<SentimentSource> = new Set([
	"reddit",
	"x",
	"polymarket",
	"news",
]);
const ASSETS: ReadonlySet<SentimentAsset> = new Set(["stocks", "crypto"]);
const DEFAULT_SOURCE: SentimentSource = "reddit";
const DEFAULT_ASSET: SentimentAsset = "stocks";
const NEWS_SOURCE: SentimentSource = "news";

export interface SentimentFetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export function coerceSentimentSource(value: unknown): SentimentSource {
	return typeof value === "string" && SOURCES.has(value as SentimentSource)
		? (value as SentimentSource)
		: DEFAULT_SOURCE;
}

// `news` only covers stocks — crypto + news degrades to stocks rather than
// erroring, since the caller almost always just wants "the news sentiment".
export function coerceSentimentAsset(
	value: unknown,
	source: SentimentSource
): SentimentAsset {
	if (source === NEWS_SOURCE) {
		return DEFAULT_ASSET;
	}
	return typeof value === "string" && ASSETS.has(value as SentimentAsset)
		? (value as SentimentAsset)
		: DEFAULT_ASSET;
}

function num(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

function clampTrendingLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_TRENDING_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_TRENDING_LIMIT);
}

function sentimentUrl(
	source: SentimentSource,
	asset: SentimentAsset,
	path: string
): string {
	return `${BASE_URL}/${source}/${asset}/v1/${path}`;
}

async function fetchSentimentJson(
	url: string,
	apiKey: string,
	opts: SentimentFetchOpts
): Promise<unknown | null> {
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { "X-API-Key": apiKey } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		return await res.json();
	} catch {
		return null;
	}
}

interface RawTrendingRow {
	bearish_pct?: number;
	bullish_pct?: number;
	buzz_score?: number;
	company_name?: string;
	mentions?: number;
	sentiment_score?: number;
	ticker?: string;
	trend?: string;
	unique_posts?: number;
}

function normalizeTrending(row: RawTrendingRow): TrendingSentiment {
	return {
		ticker: row.ticker ?? "",
		name: row.company_name ?? "",
		buzzScore: num(row.buzz_score),
		trend: row.trend ?? "",
		mentions: num(row.mentions),
		sentimentScore: num(row.sentiment_score),
		bullishPct: num(row.bullish_pct),
		bearishPct: num(row.bearish_pct),
		uniquePosts: num(row.unique_posts),
	};
}

export async function sentimentTrending(
	source: string | undefined,
	asset: string | undefined,
	limit: number,
	apiKey: string,
	opts: SentimentFetchOpts = {}
): Promise<TrendingSentiment[]> {
	if (!apiKey) {
		throw new NotConfiguredError("ADANOS_API_KEY is not set");
	}
	const src = coerceSentimentSource(source);
	const ast = coerceSentimentAsset(asset, src);
	const cappedLimit = clampTrendingLimit(limit);
	const url = `${sentimentUrl(src, ast, "trending")}?limit=${cappedLimit}`;
	const json = await fetchSentimentJson(url, apiKey, opts);
	return Array.isArray(json)
		? (json as RawTrendingRow[]).map(normalizeTrending)
		: [];
}

interface RawDailyTrend {
	bearish_pct?: number;
	bullish_pct?: number;
	buzz_score?: number;
	date?: string;
	mentions?: number;
	sentiment_score?: number;
}

interface RawTickerPayload {
	bearish_pct?: number;
	bullish_pct?: number;
	buzz_score?: number;
	company_name?: string;
	daily_trend?: RawDailyTrend[] | null;
	found?: boolean;
	mentions?: number;
	negative_count?: number;
	neutral_count?: number;
	period_days?: number;
	positive_count?: number;
	sentiment_score?: number;
	ticker?: string;
	trend?: string;
}

function normalizeDailyTrend(row: RawDailyTrend): DailySentiment {
	return {
		date: row.date ?? "",
		mentions: num(row.mentions),
		sentimentScore: num(row.sentiment_score),
		buzzScore: num(row.buzz_score),
		bullishPct: num(row.bullish_pct),
		bearishPct: num(row.bearish_pct),
	};
}

function normalizeTicker(raw: RawTickerPayload): TickerSentiment {
	return {
		ticker: raw.ticker ?? "",
		name: raw.company_name ?? "",
		found: raw.found ?? false,
		buzzScore: num(raw.buzz_score),
		mentions: num(raw.mentions),
		sentimentScore: num(raw.sentiment_score),
		bullishPct: num(raw.bullish_pct),
		bearishPct: num(raw.bearish_pct),
		positiveCount: num(raw.positive_count),
		negativeCount: num(raw.negative_count),
		neutralCount: num(raw.neutral_count),
		trend: raw.trend ?? "",
		periodDays: num(raw.period_days),
		dailyTrend: (raw.daily_trend ?? []).map(normalizeDailyTrend),
	};
}

function tickerEndpoint(asset: SentimentAsset, ticker: string): string {
	return asset === "crypto" ? `token/${ticker}` : `stock/${ticker}`;
}

export async function sentimentTicker(
	ticker: string,
	source: string | undefined,
	asset: string | undefined,
	apiKey: string,
	opts: SentimentFetchOpts = {}
): Promise<TickerSentiment | null> {
	if (!apiKey) {
		throw new NotConfiguredError("ADANOS_API_KEY is not set");
	}
	const src = coerceSentimentSource(source);
	const ast = coerceSentimentAsset(asset, src);
	const upperTicker = ticker.toUpperCase();
	const url = sentimentUrl(src, ast, tickerEndpoint(ast, upperTicker));
	const json = await fetchSentimentJson(url, apiKey, opts);
	if (!json || typeof json !== "object") {
		return null;
	}
	return normalizeTicker(json as RawTickerPayload);
}

interface RawSentimentDriver {
	buzz_score?: number;
	mentions?: number;
	sentiment_score?: number;
	ticker?: string;
}

interface RawMarketPayload {
	active_tickers?: number;
	bearish_pct?: number;
	bullish_pct?: number;
	buzz_score?: number;
	drivers?: RawSentimentDriver[] | null;
	mentions?: number;
	negative_count?: number;
	neutral_count?: number;
	positive_count?: number;
	sentiment_score?: number;
	trend?: string;
}

function normalizeDriver(row: RawSentimentDriver): SentimentDriver {
	return {
		ticker: row.ticker ?? "",
		mentions: num(row.mentions),
		buzzScore: num(row.buzz_score),
		sentimentScore: num(row.sentiment_score),
	};
}

function normalizeMarket(raw: RawMarketPayload): MarketSentiment {
	return {
		buzzScore: num(raw.buzz_score),
		trend: raw.trend ?? "",
		mentions: num(raw.mentions),
		sentimentScore: num(raw.sentiment_score),
		bullishPct: num(raw.bullish_pct),
		bearishPct: num(raw.bearish_pct),
		activeTickers: num(raw.active_tickers),
		positiveCount: num(raw.positive_count),
		negativeCount: num(raw.negative_count),
		neutralCount: num(raw.neutral_count),
		drivers: (raw.drivers ?? []).map(normalizeDriver),
	};
}

export async function sentimentMarket(
	source: string | undefined,
	asset: string | undefined,
	apiKey: string,
	opts: SentimentFetchOpts = {}
): Promise<MarketSentiment | null> {
	if (!apiKey) {
		throw new NotConfiguredError("ADANOS_API_KEY is not set");
	}
	const src = coerceSentimentSource(source);
	const ast = coerceSentimentAsset(asset, src);
	const url = sentimentUrl(src, ast, "market-sentiment");
	const json = await fetchSentimentJson(url, apiKey, opts);
	if (!json || typeof json !== "object") {
		return null;
	}
	return normalizeMarket(json as RawMarketPayload);
}
