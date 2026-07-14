// Kalshi prediction markets via the free public elections API (no auth).
// June-2026 schema: every price field is a STRING in dollars (*_dollars)
// and volume/open-interest fields are fixed-point STRINGS (*_fp) — the old
// integer-cents fields are gone. Upstream quirks: there is NO server-side
// volume sort (sort params are silently ignored) and the default order
// buries active markets behind dead sports contracts, so we fetch a large
// page and filter/sort/slice client-side by 24h volume.
import { fetchWithRetry } from "../http";

const KALSHI_MARKETS_URL =
	"https://api.elections.kalshi.com/trade-api/v2/markets";
const FETCH_LIMIT = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface RawKalshiMarket {
	close_time?: string;
	event_ticker?: string;
	last_price_dollars?: string;
	liquidity_dollars?: string;
	market_type?: string;
	open_interest_fp?: string;
	previous_price_dollars?: string;
	ticker?: string;
	title?: string;
	volume_24h_fp?: string;
	volume_fp?: string;
	yes_ask_dollars?: string;
	yes_bid_dollars?: string;
	yes_sub_title?: string;
}

interface RawKalshiResponse {
	markets?: RawKalshiMarket[];
}

export interface KalshiMarket {
	closeTime: string;
	eventTicker: string;
	liquidity: number;
	openInterest: number;
	prevPrice: number | null;
	subtitle: string;
	ticker: string;
	title: string;
	volume: number;
	volume24h: number;
	yesAsk: number | null;
	yesBid: number | null;
	yesPrice: number | null;
}

function toNumberOrNull(value: string | undefined): number | null {
	if (value === undefined || value === "") {
		return null;
	}
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(value: string | undefined): number {
	return toNumberOrNull(value) ?? 0;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// Pure row mapper from the raw June-2026 Kalshi schema (string dollars /
// fixed-point strings) to numeric fields. Exported for tests.
export function toKalshiMarket(raw: RawKalshiMarket): KalshiMarket {
	return {
		ticker: raw.ticker ?? "",
		eventTicker: raw.event_ticker ?? "",
		title: raw.title ?? "",
		subtitle: raw.yes_sub_title ?? "",
		yesPrice: toNumberOrNull(raw.last_price_dollars),
		prevPrice: toNumberOrNull(raw.previous_price_dollars),
		yesBid: toNumberOrNull(raw.yes_bid_dollars),
		yesAsk: toNumberOrNull(raw.yes_ask_dollars),
		volume: toNumberOrZero(raw.volume_fp),
		volume24h: toNumberOrZero(raw.volume_24h_fp),
		openInterest: toNumberOrZero(raw.open_interest_fp),
		liquidity: toNumberOrZero(raw.liquidity_dollars),
		closeTime: raw.close_time ?? "",
	};
}

function matchesQuery(market: KalshiMarket, query: string): boolean {
	const haystack = `${market.title} ${market.subtitle}`.toLowerCase();
	return haystack.includes(query.toLowerCase());
}

function buildUrl(series: string): string {
	const base = `${KALSHI_MARKETS_URL}?limit=${FETCH_LIMIT}&status=open`;
	return series ? `${base}&series_ticker=${encodeURIComponent(series)}` : base;
}

// series ""=all series; query ""=no filter. Fetches one large page, then
// filters, sorts by 24h volume desc, and slices to `limit` client-side.
// Degrades to [] on any upstream failure.
export async function getKalshiMarkets(
	series: string,
	query: string,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<KalshiMarket[]> {
	const cappedLimit = clampLimit(limit);
	try {
		const res = await fetchWithRetry(
			buildUrl(series),
			{},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as RawKalshiResponse;
		const rows = Array.isArray(json.markets) ? json.markets : [];
		const mapped = rows.map(toKalshiMarket);
		const filtered = query
			? mapped.filter((m) => matchesQuery(m, query))
			: mapped;
		filtered.sort((a, b) => b.volume24h - a.volume24h);
		return filtered.slice(0, cappedLimit);
	} catch {
		return [];
	}
}
