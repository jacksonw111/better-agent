// Adanos multi-ticker sentiment compare, split out of sentiment.ts (which is
// at the project's 300-line-per-file cap). Reuses sentiment.ts's
// TrendingSentiment normalization, URL builder, and fetch helper.
import { NotConfiguredError } from "../fred/economic";
import type { TrendingSentiment } from "../types-extra";
import {
	coerceSentimentAsset,
	coerceSentimentSource,
	fetchSentimentJson,
	normalizeTrending,
	num,
	type RawTrendingRow,
	type SentimentFetchOpts,
	type SentimentSource,
	sentimentUrl,
} from "./sentiment";

interface RawCompareRow extends RawTrendingRow {
	unique_tweets?: number;
}

interface RawComparePayload {
	period_days?: number;
	stocks?: RawCompareRow[] | null;
}

const DEFAULT_COMPARE_SOURCE: SentimentSource = "x";

function normalizeCompareRow(row: RawCompareRow): TrendingSentiment {
	return {
		...normalizeTrending(row),
		uniquePosts: num(row.unique_tweets ?? row.unique_posts),
	};
}

export async function sentimentCompare(
	tickers: string[],
	source: string | undefined,
	asset: string | undefined,
	apiKey: string,
	opts: SentimentFetchOpts = {}
): Promise<TrendingSentiment[]> {
	if (!apiKey) {
		throw new NotConfiguredError("ADANOS_API_KEY is not set");
	}
	const src = coerceSentimentSource(source ?? DEFAULT_COMPARE_SOURCE);
	const ast = coerceSentimentAsset(asset, src);
	const upperTickers = tickers.map((t) => t.toUpperCase());
	const url = `${sentimentUrl(src, ast, "compare")}?tickers=${upperTickers.join(",")}`;
	const json = await fetchSentimentJson(url, apiKey, opts);
	if (!json || typeof json !== "object") {
		return [];
	}
	const stocks = (json as RawComparePayload).stocks;
	return Array.isArray(stocks) ? stocks.map(normalizeCompareRow) : [];
}
