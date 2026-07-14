// US option chain via Yahoo v7/finance/options (US tickers only — HK/CN
// symbols simply return an empty chain). Optional `expiration` (Unix
// seconds) selects a specific expiry; omitted = nearest expiry plus the
// full expirationDates list for follow-up calls.
import { fetchWithRetry } from "../http";
import { getYahooAuth, rawNum, yahooAuthHeaders } from "./session";

const OPTIONS_URL = "https://query2.finance.yahoo.com/v7/finance/options";

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export interface UsOptionRow {
	ask: number | null;
	bid: number | null;
	contractSymbol: string;
	impliedVolatility: number | null;
	inTheMoney: boolean;
	lastPrice: number | null;
	openInterest: number | null;
	strike: number | null;
	volume: number | null;
}

export interface UsOptionChain {
	calls: UsOptionRow[];
	expirationDates: number[];
	puts: UsOptionRow[];
	underlyingPrice: number | null;
}

function emptyChain(): UsOptionChain {
	return { underlyingPrice: null, expirationDates: [], calls: [], puts: [] };
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function toRow(raw: Record<string, unknown>): UsOptionRow {
	return {
		contractSymbol:
			typeof raw.contractSymbol === "string" ? raw.contractSymbol : "",
		strike: rawNum(raw.strike),
		lastPrice: rawNum(raw.lastPrice),
		bid: rawNum(raw.bid),
		ask: rawNum(raw.ask),
		// volume/openInterest arrive as plain numbers or {raw,fmt} — rawNum
		// accepts both shapes.
		volume: rawNum(raw.volume),
		openInterest: rawNum(raw.openInterest),
		impliedVolatility: rawNum(raw.impliedVolatility),
		inTheMoney: raw.inTheMoney === true,
	};
}

function toRows(value: unknown): UsOptionRow[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => toRow(asRecord(entry)));
}

function parseChain(result: Record<string, unknown>): UsOptionChain {
	const expirationDates = Array.isArray(result.expirationDates)
		? result.expirationDates.filter(
				(d): d is number => typeof d === "number" && Number.isFinite(d)
			)
		: [];
	const optionsList = Array.isArray(result.options) ? result.options : [];
	const nearest = asRecord(optionsList[0]);
	const quote = asRecord(result.quote);
	return {
		underlyingPrice: rawNum(quote.regularMarketPrice),
		expirationDates,
		calls: toRows(nearest.calls),
		puts: toRows(nearest.puts),
	};
}

export async function getUsOptions(
	symbol: string,
	expiration: number | undefined,
	opts: FetchOpts = {}
): Promise<UsOptionChain> {
	const auth = await getYahooAuth(opts);
	if (!auth) {
		return emptyChain();
	}
	const dateParam = expiration === undefined ? "" : `&date=${expiration}`;
	const url = `${OPTIONS_URL}/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(auth.crumb)}${dateParam}`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: yahooAuthHeaders(auth) },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return emptyChain();
		}
		const json = (await res.json()) as {
			optionChain?: { result?: unknown[] | null } | null;
		};
		const result = asRecord(json.optionChain?.result?.[0]);
		return parseChain(result);
	} catch {
		return emptyChain();
	}
}
