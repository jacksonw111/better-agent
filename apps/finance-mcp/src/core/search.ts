// Combined ticker search shared by the MCP handler and the REST facade:
// EastMoney suggest (A-share) and Yahoo search (US) queried in parallel,
// merged into one list with a market discriminator. Either upstream already
// degrades to [] on failure, so a one-sided outage still returns the other
// market's hits.
import { searchAStocks } from "./eastmoney/search";
import type { StockHit } from "./types";
import { searchUsStocks } from "./yahoo/search";

export interface UsHit {
	code: string;
	exchange: string;
	market: "us";
	name: string;
	type: "EQUITY" | "ETF";
}

export type CombinedHit = StockHit | UsHit;

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export async function searchStocks(
	query: string,
	opts: Opts = {}
): Promise<CombinedHit[]> {
	const [aShare, us] = await Promise.all([
		searchAStocks(query, opts),
		searchUsStocks(query, opts),
	]);
	const usHits: UsHit[] = us.map((hit) => ({
		code: hit.symbol,
		exchange: hit.exchange,
		market: "us",
		name: hit.name,
		type: hit.type,
	}));
	return [...aShare, ...usHits];
}
