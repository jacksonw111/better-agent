// US ticker search via Yahoo's public search endpoint (no cookie/crumb
// needed, unlike quoteSummary). Yahoo returns global listings — foreign
// lines carry an exchange suffix (APC.DE, APLE.TO), US tickers are dot-free
// (share classes use a dash, e.g. BRK-B) — so US-only is a dot filter.
import { fetchWithRetry } from "../http";
import { YAHOO_USER_AGENT } from "./session";

const SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";
// Ask for more than we keep: the dot filter drops foreign listings.
const QUOTES_COUNT = 20;
const DEFAULT_LIMIT = 10;
const US_TYPES = new Set(["EQUITY", "ETF"]);

export interface UsStockHit {
	exchange: string;
	name: string;
	symbol: string;
	type: "EQUITY" | "ETF";
}

interface RawQuote {
	exchDisp?: string;
	longname?: string;
	quoteType?: string;
	shortname?: string;
	symbol?: string;
}

interface Opts {
	fetchImpl?: typeof fetch;
	limit?: number;
	signal?: AbortSignal;
}

function isUsHit(q: RawQuote): q is RawQuote & { symbol: string } {
	return (
		typeof q.symbol === "string" &&
		q.symbol.length > 0 &&
		!q.symbol.includes(".") &&
		US_TYPES.has(q.quoteType ?? "")
	);
}

function toHit(q: RawQuote & { symbol: string }): UsStockHit {
	return {
		exchange: q.exchDisp ?? "",
		name: q.longname ?? q.shortname ?? "",
		symbol: q.symbol,
		type: q.quoteType === "ETF" ? "ETF" : "EQUITY",
	};
}

export async function searchUsStocks(
	query: string,
	opts: Opts = {}
): Promise<UsStockHit[]> {
	const url =
		`${SEARCH_URL}?q=${encodeURIComponent(query)}` +
		`&quotesCount=${QUOTES_COUNT}&newsCount=0`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { "User-Agent": YAHOO_USER_AGENT } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as { quotes?: RawQuote[] | null };
		return (json.quotes ?? [])
			.filter(isUsHit)
			.map(toHit)
			.slice(0, opts.limit ?? DEFAULT_LIMIT);
	} catch {
		return [];
	}
}
