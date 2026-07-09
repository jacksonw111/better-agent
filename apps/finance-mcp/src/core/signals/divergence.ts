// Price↔sentiment divergence signal: combines a recent price trend (Tencent
// kline) with Adanos crowd sentiment to flag 顶背离/底背离/共振. US-oriented
// (Adanos covers US stocks; kline works fine for US symbols too).
import { sentimentTicker } from "../adanos/sentiment";
import { NotConfiguredError } from "../fred/economic";
import { getKline } from "../tencent/kline";
import type { Candle } from "../types";
import type {
	Divergence,
	DivergenceSignal,
	PriceTrend,
	SentimentTrendDir,
	TickerSentiment,
} from "../types-extra";

const MIN_CANDLES = 6;
const KLINE_LOOKBACK_DAYS = 30;
const TREND_PCT_THRESHOLD = 1;
const SENTIMENT_PCT_THRESHOLD = 5;
const SENTIMENT_SCORE_THRESHOLD = 0.05;
const PCT_MULTIPLIER = 100;

interface DivergenceOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

function pctChange(current: number, prior: number): number {
	return prior === 0 ? 0 : ((current - prior) / prior) * PCT_MULTIPLIER;
}

function priceTrendFromChange(change5d: number): PriceTrend {
	if (change5d > TREND_PCT_THRESHOLD) {
		return "up";
	}
	return change5d < -TREND_PCT_THRESHOLD ? "down" : "flat";
}

interface PriceStats {
	priceChange1d: number | null;
	priceChange5d: number | null;
	priceTrend: PriceTrend | null;
}

function computePriceStats(candles: Candle[]): PriceStats {
	if (candles.length < MIN_CANDLES) {
		return { priceChange1d: null, priceChange5d: null, priceTrend: null };
	}
	const closes = candles.map((c) => c.close);
	const last = closes.at(-1) ?? 0;
	const priceChange1d = pctChange(last, closes.at(-2) ?? 0);
	const priceChange5d = pctChange(last, closes.at(-6) ?? 0);
	return {
		priceChange1d,
		priceChange5d,
		priceTrend: priceTrendFromChange(priceChange5d),
	};
}

function sentimentTrendFrom(net: number, score: number): SentimentTrendDir {
	if (net > SENTIMENT_PCT_THRESHOLD || score > SENTIMENT_SCORE_THRESHOLD) {
		return "bullish";
	}
	if (net < -SENTIMENT_PCT_THRESHOLD || score < -SENTIMENT_SCORE_THRESHOLD) {
		return "bearish";
	}
	return "neutral";
}

interface SentimentStats {
	bearishPct: number | null;
	bullishPct: number | null;
	buzzScore: number | null;
	sentimentNet: number | null;
	sentimentScore: number | null;
	sentimentTrend: SentimentTrendDir | null;
}

const EMPTY_SENTIMENT_STATS: SentimentStats = {
	bearishPct: null,
	bullishPct: null,
	buzzScore: null,
	sentimentNet: null,
	sentimentScore: null,
	sentimentTrend: null,
};

function computeSentimentStats(
	sentiment: TickerSentiment | null
): SentimentStats {
	if (!sentiment?.found) {
		return EMPTY_SENTIMENT_STATS;
	}
	const sentimentNet = sentiment.bullishPct - sentiment.bearishPct;
	return {
		bearishPct: sentiment.bearishPct,
		bullishPct: sentiment.bullishPct,
		buzzScore: sentiment.buzzScore,
		sentimentNet,
		sentimentScore: sentiment.sentimentScore,
		sentimentTrend: sentimentTrendFrom(sentimentNet, sentiment.sentimentScore),
	};
}

interface SignalNote {
	note: string;
	signal: DivergenceSignal;
}

const INSUFFICIENT_SIGNAL: SignalNote = {
	signal: "数据不足",
	note: "Insufficient price history or sentiment coverage to compute a signal.",
};

const NEUTRAL_SIGNAL: SignalNote = {
	signal: "中性",
	note: "No clear divergence or resonance between price and sentiment.",
};

// Keyed by `${priceTrend}:${sentimentTrend}` — a lookup table (rather than a
// chain of `&&` conditionals) keeps this well under the complexity cap.
const SIGNAL_BY_COMBO: Record<string, SignalNote> = {
	"up:bearish": {
		signal: "顶背离",
		note: "Price rising while crowd sentiment turns bearish — potential exhaustion.",
	},
	"down:bullish": {
		signal: "底背离",
		note: "Price falling while crowd sentiment stays bullish — potential bottom.",
	},
	"up:bullish": {
		signal: "多头共振",
		note: "Price and sentiment both bullish — trend confirmation.",
	},
	"down:bearish": {
		signal: "空头共振",
		note: "Price and sentiment both bearish — trend confirmation.",
	},
};

function computeSignal(
	priceTrend: PriceTrend | null,
	sentimentTrend: SentimentTrendDir | null
): SignalNote {
	if (!(priceTrend && sentimentTrend)) {
		return INSUFFICIENT_SIGNAL;
	}
	return SIGNAL_BY_COMBO[`${priceTrend}:${sentimentTrend}`] ?? NEUTRAL_SIGNAL;
}

async function fetchCandles(
	ticker: string,
	opts: DivergenceOpts
): Promise<Candle[]> {
	try {
		return await getKline(ticker, "day", KLINE_LOOKBACK_DAYS, opts);
	} catch {
		return [];
	}
}

async function fetchSentiment(
	ticker: string,
	source: string | undefined,
	apiKey: string,
	opts: DivergenceOpts
): Promise<TickerSentiment | null> {
	try {
		return await sentimentTicker(ticker, source, "stocks", apiKey, opts);
	} catch {
		return null;
	}
}

export async function getDivergence(
	ticker: string,
	source: string | undefined,
	apiKey: string,
	opts: DivergenceOpts = {}
): Promise<Divergence | null> {
	if (!apiKey) {
		throw new NotConfiguredError("ADANOS_API_KEY is not set");
	}
	const [candles, sentiment] = await Promise.all([
		fetchCandles(ticker, opts),
		fetchSentiment(ticker, source, apiKey, opts),
	]);
	if (candles.length === 0 && !sentiment?.found) {
		return null;
	}
	const priceStats = computePriceStats(candles);
	const sentimentStats = computeSentimentStats(sentiment);
	const { signal, note } = computeSignal(
		priceStats.priceTrend,
		sentimentStats.sentimentTrend
	);
	return {
		ticker: ticker.toUpperCase(),
		priceChange1d: priceStats.priceChange1d,
		priceChange5d: priceStats.priceChange5d,
		priceTrend: priceStats.priceTrend,
		buzzScore: sentimentStats.buzzScore,
		sentimentScore: sentimentStats.sentimentScore,
		bullishPct: sentimentStats.bullishPct,
		bearishPct: sentimentStats.bearishPct,
		sentimentNet: sentimentStats.sentimentNet,
		sentimentTrend: sentimentStats.sentimentTrend,
		signal,
		note,
	};
}
