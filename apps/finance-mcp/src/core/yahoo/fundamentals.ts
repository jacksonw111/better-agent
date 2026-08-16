// US fundamentals via Yahoo quoteSummary: a valuation snapshot (key metrics)
// and the company profile. Complements the SEC XBRL annual series in
// core/sec/us-financials.ts with the market-priced multiples Yahoo computes.
import { rawNum, yahooQuoteSummary } from "./session";

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

const METRICS_MODULES = [
	"price",
	"summaryDetail",
	"defaultKeyStatistics",
	"financialData",
];
const PROFILE_MODULES = ["assetProfile", "price"];
const PCT = 100;
const ROUND_SCALE = 100;

export interface UsKeyMetrics {
	beta: number | null;
	changePct: number | null;
	close: number | null;
	currency: string | null;
	dividendYieldPct: number | null;
	epsTtm: number | null;
	grossMarginPct: number | null;
	high52w: number | null;
	low52w: number | null;
	marketCap: number | null;
	name: string | null;
	netMarginPct: number | null;
	pb: number | null;
	peForward: number | null;
	peg: number | null;
	peTtm: number | null;
	ps: number | null;
	roePct: number | null;
	sharesOutstanding: number | null;
	symbol: string;
	targetMeanPrice: number | null;
}

export interface UsCompanyProfile {
	city: string | null;
	country: string | null;
	employees: number | null;
	exchange: string | null;
	industry: string | null;
	name: string | null;
	sector: string | null;
	summary: string | null;
	symbol: string;
	website: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function strOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function round2(value: number): number {
	return Math.round(value * ROUND_SCALE) / ROUND_SCALE;
}

// Yahoo returns ratio fields (change, yield, margins, ROE) as fractions;
// rendered as percentages to match the A-share fundamentals conventions.
function pct(value: number | null): number | null {
	return value === null ? null : round2(value * PCT);
}

function toMetrics(
	symbol: string,
	summary: Record<string, unknown>
): UsKeyMetrics {
	const price = asRecord(summary.price);
	const detail = asRecord(summary.summaryDetail);
	const stats = asRecord(summary.defaultKeyStatistics);
	const fin = asRecord(summary.financialData);
	return {
		symbol,
		name: strOrNull(price.longName) ?? strOrNull(price.shortName),
		currency: strOrNull(price.currency),
		close: rawNum(price.regularMarketPrice),
		changePct: pct(rawNum(price.regularMarketChangePercent)),
		marketCap: rawNum(price.marketCap) ?? rawNum(detail.marketCap),
		peTtm: rawNum(detail.trailingPE),
		peForward: rawNum(detail.forwardPE),
		pb: rawNum(stats.priceToBook),
		ps: rawNum(detail.priceToSalesTrailing12Months),
		peg: rawNum(stats.pegRatio),
		epsTtm: rawNum(stats.trailingEps),
		beta: rawNum(detail.beta),
		dividendYieldPct: pct(rawNum(detail.dividendYield)),
		high52w: rawNum(detail.fiftyTwoWeekHigh),
		low52w: rawNum(detail.fiftyTwoWeekLow),
		sharesOutstanding: rawNum(stats.sharesOutstanding),
		roePct: pct(rawNum(fin.returnOnEquity)),
		grossMarginPct: pct(rawNum(fin.grossMargins)),
		netMarginPct: pct(rawNum(fin.profitMargins)),
		targetMeanPrice: rawNum(fin.targetMeanPrice),
	};
}

function toProfile(
	symbol: string,
	summary: Record<string, unknown>
): UsCompanyProfile {
	const profile = asRecord(summary.assetProfile);
	const price = asRecord(summary.price);
	return {
		symbol,
		name: strOrNull(price.longName) ?? strOrNull(price.shortName),
		exchange: strOrNull(price.exchangeName),
		sector: strOrNull(profile.sector),
		industry: strOrNull(profile.industry),
		website: strOrNull(profile.website),
		employees: rawNum(profile.fullTimeEmployees),
		country: strOrNull(profile.country),
		city: strOrNull(profile.city),
		summary: strOrNull(profile.longBusinessSummary),
	};
}

export async function getUsKeyMetrics(
	ticker: string,
	opts: FetchOpts = {}
): Promise<UsKeyMetrics | null> {
	const summary = await yahooQuoteSummary(ticker, METRICS_MODULES, opts);
	if (!summary) {
		return null;
	}
	return toMetrics(ticker.toUpperCase(), summary);
}

export async function getUsProfile(
	ticker: string,
	opts: FetchOpts = {}
): Promise<UsCompanyProfile | null> {
	const summary = await yahooQuoteSummary(ticker, PROFILE_MODULES, opts);
	if (!summary) {
		return null;
	}
	return toProfile(ticker.toUpperCase(), summary);
}
