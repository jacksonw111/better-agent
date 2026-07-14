// Polymarket probability history: resolves a query to the top matching
// active Gamma market, takes its Yes CLOB token, then pulls the price
// series from the CLOB prices-history endpoint. As in markets.ts, the
// Gamma `outcomes` / `clobTokenIds` fields are JSON-ENCODED STRINGS (not
// arrays) and must be parsed defensively.
import { fetchWithRetry } from "../http";

const GAMMA_URL = "https://gamma-api.polymarket.com/markets";
const HISTORY_URL = "https://clob.polymarket.com/prices-history";
const GAMMA_FETCH_LIMIT = 100;
const HISTORY_FIDELITY = 720;
const MAX_POINTS = 100;
const DEFAULT_INTERVAL = "1w";
const VALID_INTERVALS = new Set(["1d", "1w", "1m", "max"]);
const MS_PER_SECOND = 1000;
// "YYYY-MM-DD HH:mm" is the first 16 chars of an ISO timestamp.
const TIME_SLICE_LENGTH = 16;
const DEFAULT_OUTCOME = "Yes";

export interface RawGammaMarket {
	clobTokenIds?: string;
	outcomes?: string;
	question?: string;
	slug?: string;
}

interface RawHistoryPoint {
	p?: number;
	t?: number;
}

interface RawHistoryResponse {
	history?: RawHistoryPoint[];
}

export interface PredictionHistory {
	interval: string;
	outcome: string;
	points: { time: string; probability: number }[];
	question: string;
	slug: string;
}

type HistoryPoints = PredictionHistory["points"];

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

// Parses a Gamma API JSON-encoded-string array field (e.g. `clobTokenIds`),
// returning null (not throwing) on malformed input.
function parseJsonArray(text: string | undefined): unknown[] | null {
	if (!text) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

// Pure market matcher: first market whose question contains `query`
// (case-insensitive); empty query = the top (first) market. Exported for
// tests.
export function findMatchingMarket(
	markets: RawGammaMarket[],
	query: string
): RawGammaMarket | null {
	if (!query) {
		return markets[0] ?? null;
	}
	const needle = query.toLowerCase();
	return (
		markets.find((m) => (m.question ?? "").toLowerCase().includes(needle)) ??
		null
	);
}

// Pure even downsampler: keeps at most `maxPoints` points, always
// including the first and last. Exported for tests.
export function downsampleEvenly<T>(points: T[], maxPoints: number): T[] {
	if (maxPoints <= 0 || points.length <= maxPoints) {
		return points;
	}
	const lastIndex = points.length - 1;
	const step = lastIndex / Math.max(maxPoints - 1, 1);
	const result: T[] = [];
	for (let i = 0; i < maxPoints; i++) {
		const point = points[Math.round(i * step)];
		if (point !== undefined) {
			result.push(point);
		}
	}
	return result;
}

function coerceInterval(interval: string): string {
	return VALID_INTERVALS.has(interval) ? interval : DEFAULT_INTERVAL;
}

function toTimeString(unixSeconds: number): string {
	return new Date(unixSeconds * MS_PER_SECOND)
		.toISOString()
		.slice(0, TIME_SLICE_LENGTH)
		.replace("T", " ");
}

function firstOutcomeName(raw: RawGammaMarket): string {
	const first = parseJsonArray(raw.outcomes)?.[0];
	return first === undefined || first === null
		? DEFAULT_OUTCOME
		: String(first);
}

// The first CLOB token id is the Yes-outcome token.
function yesTokenId(raw: RawGammaMarket): string | null {
	const first = parseJsonArray(raw.clobTokenIds)?.[0];
	return first === undefined || first === null ? null : String(first);
}

function toPoints(raw: RawHistoryPoint[]): HistoryPoints {
	const points: HistoryPoints = [];
	for (const item of raw) {
		if (typeof item.t === "number" && typeof item.p === "number") {
			points.push({ time: toTimeString(item.t), probability: item.p });
		}
	}
	return points;
}

async function fetchTopMarkets(opts: FetchOpts): Promise<RawGammaMarket[]> {
	const url =
		`${GAMMA_URL}?active=true&closed=false&order=volume24hr` +
		`&ascending=false&limit=${GAMMA_FETCH_LIMIT}`;
	const res = await fetchWithRetry(url, {}, opts);
	if (!res.ok) {
		return [];
	}
	const raw = (await res.json()) as RawGammaMarket[];
	return Array.isArray(raw) ? raw : [];
}

async function fetchHistoryPoints(
	tokenId: string,
	interval: string,
	opts: FetchOpts
): Promise<RawHistoryPoint[]> {
	const url =
		`${HISTORY_URL}?market=${encodeURIComponent(tokenId)}` +
		`&interval=${interval}&fidelity=${HISTORY_FIDELITY}`;
	const res = await fetchWithRetry(url, {}, opts);
	if (!res.ok) {
		return [];
	}
	const json = (await res.json()) as RawHistoryResponse;
	return Array.isArray(json.history) ? json.history : [];
}

// interval: one of 1d/1w/1m/max; anything else is coerced to "1w".
// Returns null when no market matches, the Yes token is missing, or the
// history comes back empty — never throws.
export async function getPredictionHistory(
	query: string,
	interval: string,
	opts: FetchOpts = {}
): Promise<PredictionHistory | null> {
	const coercedInterval = coerceInterval(interval);
	try {
		const market = findMatchingMarket(await fetchTopMarkets(opts), query);
		if (!market) {
			return null;
		}
		const tokenId = yesTokenId(market);
		if (!tokenId) {
			return null;
		}
		const points = toPoints(
			await fetchHistoryPoints(tokenId, coercedInterval, opts)
		);
		if (points.length === 0) {
			return null;
		}
		return {
			question: market.question ?? "",
			slug: market.slug ?? "",
			outcome: firstOutcomeName(market),
			interval: coercedInterval,
			points: downsampleEvenly(points, MAX_POINTS),
		};
	} catch {
		return null;
	}
}
