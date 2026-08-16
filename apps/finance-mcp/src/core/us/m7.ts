// Magnificent 7 (美股七巨头) dashboard: one Yahoo batch-quote call for the
// fixed AAPL/MSFT/GOOGL/AMZN/NVDA/META/TSLA set, plus cross-stock aggregates
// (total market cap, cap-weighted day change, advancer count) that no
// per-symbol tool can produce.
import { plainNum, yahooQuotes } from "../yahoo/quotes";

export const M7_SYMBOLS = [
	"AAPL",
	"MSFT",
	"GOOGL",
	"AMZN",
	"NVDA",
	"META",
	"TSLA",
] as const;

const PCT = 100;
const ROUND_SCALE = 100;

export interface M7Row {
	changePct: number | null;
	epsTtm: number | null;
	/** Distance below the 52-week high, percent (0 = at the high). */
	fromHigh52wPct: number | null;
	high52w: number | null;
	low52w: number | null;
	marketCap: number | null;
	name: string;
	pb: number | null;
	peForward: number | null;
	peTtm: number | null;
	price: number | null;
	symbol: string;
	volume: number | null;
}

export interface M7Snapshot {
	advancers: number;
	/** Day change of the basket, weighted by market cap, percent. */
	capWeightedChangePct: number | null;
	decliners: number;
	/** Rows sorted by market cap, largest first. */
	stocks: M7Row[];
	totalMarketCap: number;
}

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

function round2(value: number): number {
	return Math.round(value * ROUND_SCALE) / ROUND_SCALE;
}

function toRow(quote: Record<string, unknown>): M7Row {
	const changePct = plainNum(quote.regularMarketChangePercent);
	// fiftyTwoWeekHighChangePercent is a fraction (-0.11 = 11% below the high).
	const fromHigh = plainNum(quote.fiftyTwoWeekHighChangePercent);
	return {
		changePct: changePct === null ? null : round2(changePct),
		epsTtm: plainNum(quote.epsTrailingTwelveMonths),
		fromHigh52wPct: fromHigh === null ? null : round2(-fromHigh * PCT),
		high52w: plainNum(quote.fiftyTwoWeekHigh),
		low52w: plainNum(quote.fiftyTwoWeekLow),
		marketCap: plainNum(quote.marketCap),
		name: typeof quote.shortName === "string" ? quote.shortName : "",
		pb: plainNum(quote.priceToBook),
		peForward: plainNum(quote.forwardPE),
		peTtm: plainNum(quote.trailingPE),
		price: plainNum(quote.regularMarketPrice),
		symbol: typeof quote.symbol === "string" ? quote.symbol : "",
		volume: plainNum(quote.regularMarketVolume),
	};
}

function capWeightedChange(rows: M7Row[]): number | null {
	let capSum = 0;
	let weighted = 0;
	for (const row of rows) {
		if (row.marketCap !== null && row.changePct !== null) {
			capSum += row.marketCap;
			weighted += row.marketCap * row.changePct;
		}
	}
	return capSum > 0 ? round2(weighted / capSum) : null;
}

export async function getM7(opts: Opts = {}): Promise<M7Snapshot | null> {
	const quotes = await yahooQuotes([...M7_SYMBOLS], opts);
	if (quotes.length === 0) {
		return null;
	}
	const stocks = quotes
		.map(toRow)
		.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
	return {
		advancers: stocks.filter((s) => (s.changePct ?? 0) > 0).length,
		capWeightedChangePct: capWeightedChange(stocks),
		decliners: stocks.filter((s) => (s.changePct ?? 0) < 0).length,
		stocks,
		totalMarketCap: stocks.reduce((sum, s) => sum + (s.marketCap ?? 0), 0),
	};
}
