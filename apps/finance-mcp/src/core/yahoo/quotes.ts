// Yahoo batch realtime quotes (v7/finance/quote): one call for many symbols.
// Same cookie+crumb auth as quoteSummary, but the payload differs — v7 fields
// are PLAIN numbers (no {raw, fmt} wrappers), and regularMarketChangePercent
// is already in percent units (0.22 = +0.22%), unlike the quoteSummary
// fraction of the same name.
import { fetchWithRetry } from "../http";
import { getYahooAuth, yahooAuthHeaders } from "./session";

const QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export function plainNum(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Raw v7 quote rows, in upstream order; [] on any auth/fetch failure. */
export async function yahooQuotes(
	symbols: string[],
	opts: Opts = {}
): Promise<Record<string, unknown>[]> {
	if (symbols.length === 0) {
		return [];
	}
	const auth = await getYahooAuth(opts);
	if (!auth) {
		return [];
	}
	const url =
		`${QUOTE_URL}?symbols=${encodeURIComponent(symbols.join(","))}` +
		`&crumb=${encodeURIComponent(auth.crumb)}`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: yahooAuthHeaders(auth) },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			quoteResponse?: { result?: Record<string, unknown>[] | null } | null;
		};
		return json.quoteResponse?.result ?? [];
	} catch {
		return [];
	}
}
