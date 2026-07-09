// Polymarket prediction markets via the free public Gamma API (no auth).
// VERIFIED live during research. `outcomes` / `outcomePrices` /
// `clobTokenIds` on each raw market come back as JSON-ENCODED STRINGS (not
// arrays) and must be parsed. Outcome probabilities are enriched with LIVE
// midpoints from the CLOB (clob.polymarket.com), one per outcome token,
// falling back to the Gamma `outcomePrices` value on any failure.
import { fetchWithRetry } from "../http";
import type { PredictionMarket, PredictionOutcome } from "../types-extra";

const GAMMA_URL = "https://gamma-api.polymarket.com/markets";
const CLOB_MIDPOINT_URL = "https://clob.polymarket.com/midpoint";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const QUERY_FETCH_LIMIT = 200;
const DEFAULT_FETCH_LIMIT = 100;

interface RawMarket {
	active?: boolean;
	clobTokenIds?: string;
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

// Parses `clobTokenIds` (JSON string array, one id per outcome, same order).
// Returns null (skip enrichment for this market) on malformed input or a
// length mismatch against the market's outcome count.
function parseClobTokenIds(
	raw: RawMarket,
	outcomeCount: number
): string[] | null {
	const parsed = parseJsonArray(raw.clobTokenIds);
	if (!parsed || parsed.length !== outcomeCount) {
		return null;
	}
	return parsed.map((id) => String(id));
}

interface BuiltMarkets {
	clobTokenIdsByMarket: (string[] | null)[];
	markets: PredictionMarket[];
}

function buildMarkets(
	filtered: RawMarket[],
	cappedLimit: number
): BuiltMarkets {
	const markets: PredictionMarket[] = [];
	const clobTokenIdsByMarket: (string[] | null)[] = [];
	for (const item of filtered.slice(0, cappedLimit)) {
		const market = toMarket(item);
		if (market) {
			markets.push(market);
			clobTokenIdsByMarket.push(
				parseClobTokenIds(item, market.outcomes.length)
			);
		}
	}
	return { markets, clobTokenIdsByMarket };
}

interface MidpointTarget {
	marketIdx: number;
	outcomeIdx: number;
	tokenId: string;
}

function collectMidpointTargets(
	markets: PredictionMarket[],
	clobTokenIdsByMarket: (string[] | null)[]
): MidpointTarget[] {
	const targets: MidpointTarget[] = [];
	for (const [marketIdx, market] of markets.entries()) {
		const tokenIds = clobTokenIdsByMarket[marketIdx];
		if (!tokenIds) {
			continue;
		}
		for (const [outcomeIdx] of market.outcomes.entries()) {
			const tokenId = tokenIds[outcomeIdx];
			if (tokenId) {
				targets.push({ marketIdx, outcomeIdx, tokenId });
			}
		}
	}
	return targets;
}

async function fetchMidpoint(
	tokenId: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal }
): Promise<number | null> {
	try {
		const res = await fetchWithRetry(
			`${CLOB_MIDPOINT_URL}?token_id=${tokenId}`,
			{},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as { mid?: string | number };
		const mid = Number(json.mid);
		return Number.isFinite(mid) ? mid : null;
	} catch {
		return null;
	}
}

function applyMidpoints(
	markets: PredictionMarket[],
	targets: MidpointTarget[],
	mids: (number | null)[]
): void {
	for (const [i, target] of targets.entries()) {
		const mid = mids[i];
		if (mid === null || mid === undefined) {
			continue;
		}
		const outcome = markets[target.marketIdx]?.outcomes[target.outcomeIdx];
		if (outcome) {
			outcome.probability = mid;
			outcome.livePrice = true;
		}
	}
}

// Enriches each outcome's probability with a live CLOB midpoint, in place.
// Bounded to the outcome tokens of the (already limit-capped) returned
// markets; any per-token failure silently keeps the Gamma fallback price.
async function enrichWithLiveMidpoints(
	markets: PredictionMarket[],
	clobTokenIdsByMarket: (string[] | null)[],
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal }
): Promise<void> {
	const targets = collectMidpointTargets(markets, clobTokenIdsByMarket);
	if (targets.length === 0) {
		return;
	}
	const mids = await Promise.all(
		targets.map((t) => fetchMidpoint(t.tokenId, opts))
	);
	applyMidpoints(markets, targets, mids);
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
		const { markets, clobTokenIdsByMarket } = buildMarkets(
			filtered,
			cappedLimit
		);
		await enrichWithLiveMidpoints(markets, clobTokenIdsByMarket, opts);
		return markets;
	} catch {
		return [];
	}
}
