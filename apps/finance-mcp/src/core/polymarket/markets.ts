// Polymarket prediction markets via the free public Gamma API (no auth).
// VERIFIED live during research. `outcomes` / `outcomePrices` on each raw
// market come back as JSON-ENCODED STRINGS (not arrays) and must be parsed.
import { fetchWithRetry } from "../http";
import type { PredictionMarket, PredictionOutcome } from "../types-extra";

const GAMMA_URL = "https://gamma-api.polymarket.com/markets";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const QUERY_FETCH_LIMIT = 200;
const DEFAULT_FETCH_LIMIT = 100;

interface RawMarket {
	active?: boolean;
	closed?: boolean;
	description?: string;
	endDate?: string | null;
	id?: number | string;
	liquidity?: number | string | null;
	outcomePrices?: string;
	outcomes?: string;
	question?: string;
	slug?: string;
	volume?: number | string | null;
}

function toNumberOrZero(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function fetchLimitFor(query: string | undefined, limit: number): number {
	return query ? QUERY_FETCH_LIMIT : Math.min(limit, DEFAULT_FETCH_LIMIT);
}

// Parses a Gamma API JSON-encoded-string array field (e.g. `outcomes`),
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

function parseOutcomes(raw: RawMarket): PredictionOutcome[] | null {
	const names = parseJsonArray(raw.outcomes);
	const prices = parseJsonArray(raw.outcomePrices);
	if (
		!(names && prices) ||
		names.length === 0 ||
		names.length !== prices.length
	) {
		return null;
	}
	return names.map((name, i) => ({
		name: String(name),
		probability: toNumberOrZero(prices[i]),
	}));
}

function toMarket(raw: RawMarket): PredictionMarket | null {
	const outcomes = parseOutcomes(raw);
	if (!outcomes) {
		return null;
	}
	return {
		id: String(raw.id ?? ""),
		question: raw.question ?? "",
		slug: raw.slug ?? "",
		endDate: raw.endDate ? raw.endDate.slice(0, DATE_LENGTH) : "",
		volumeUsd: toNumberOrZero(raw.volume),
		liquidityUsd: toNumberOrZero(raw.liquidity),
		outcomes,
	};
}

function matchesQuery(raw: RawMarket, query: string): boolean {
	return (raw.question ?? "").toLowerCase().includes(query.toLowerCase());
}

export async function getPredictionMarkets(
	query: string | undefined,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<PredictionMarket[]> {
	const cappedLimit = clampLimit(limit);
	const fetchLimit = fetchLimitFor(query, cappedLimit);
	const url =
		`${GAMMA_URL}?active=true&closed=false&order=volumeNum` +
		`&ascending=false&limit=${fetchLimit}`;
	try {
		const res = await fetchWithRetry(
			url,
			{},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const raw = (await res.json()) as RawMarket[];
		const filtered = query ? raw.filter((m) => matchesQuery(m, query)) : raw;
		const markets: PredictionMarket[] = [];
		for (const item of filtered.slice(0, cappedLimit)) {
			const market = toMarket(item);
			if (market) {
				markets.push(market);
			}
		}
		return markets;
	} catch {
		return [];
	}
}
