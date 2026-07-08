import { fetchWithRetry } from "../http";
import type { YieldPoint } from "../types";
import { NotConfiguredError } from "./economic";

const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";
// Walk back a few observations in case the latest is "." (not yet published).
const LOOKBACK_LIMIT = 5;
const MISSING_VALUE = ".";

const TENORS: { seriesId: string; tenor: string }[] = [
	{ tenor: "1M", seriesId: "DGS1MO" },
	{ tenor: "3M", seriesId: "DGS3MO" },
	{ tenor: "6M", seriesId: "DGS6MO" },
	{ tenor: "1Y", seriesId: "DGS1" },
	{ tenor: "2Y", seriesId: "DGS2" },
	{ tenor: "3Y", seriesId: "DGS3" },
	{ tenor: "5Y", seriesId: "DGS5" },
	{ tenor: "7Y", seriesId: "DGS7" },
	{ tenor: "10Y", seriesId: "DGS10" },
	{ tenor: "20Y", seriesId: "DGS20" },
	{ tenor: "30Y", seriesId: "DGS30" },
];

interface FredObservationRow {
	date?: string;
	value?: string;
}

export interface YieldFetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

function buildUrl(seriesId: string, apiKey: string): string {
	const params = new URLSearchParams({
		series_id: seriesId,
		api_key: apiKey,
		file_type: "json",
		sort_order: "desc",
		limit: String(LOOKBACK_LIMIT),
	});
	return `${FRED_URL}?${params.toString()}`;
}

function firstValidRow(
	rows: FredObservationRow[]
): { date: string; value: number } | null {
	for (const row of rows) {
		if (!row.date || row.value === undefined || row.value === MISSING_VALUE) {
			continue;
		}
		const value = Number(row.value);
		if (Number.isNaN(value)) {
			continue;
		}
		return { date: row.date, value };
	}
	return null;
}

async function fetchLatestYield(
	tenor: string,
	seriesId: string,
	apiKey: string,
	opts: YieldFetchOpts
): Promise<YieldPoint | null> {
	try {
		const url = buildUrl(seriesId, apiKey);
		const res = await fetchWithRetry(url, undefined, {
			fetchImpl: opts.fetchImpl,
			signal: opts.signal,
		});
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as {
			observations?: FredObservationRow[] | null;
		};
		const latest = firstValidRow(json.observations ?? []);
		if (!latest) {
			return null;
		}
		return { tenor, seriesId, date: latest.date, yield: latest.value };
	} catch {
		return null;
	}
}

export async function getYieldCurve(
	apiKey: string,
	opts: YieldFetchOpts = {}
): Promise<YieldPoint[]> {
	if (!apiKey) {
		throw new NotConfiguredError("FRED_API_KEY is not set");
	}
	const results = await Promise.all(
		TENORS.map((t) => fetchLatestYield(t.tenor, t.seriesId, apiKey, opts))
	);
	return results.filter((r): r is YieldPoint => r !== null);
}
