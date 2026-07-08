import { fetchWithRetry } from "../http";
import type {
	MacroDashboard,
	MacroDashboardRow,
	MacroObservation,
	MacroSeries,
} from "../types";
import { NotConfiguredError } from "./economic";

const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 120;
const MISSING_VALUE = ".";

// Curated indicator key -> FRED series_id map (verified live).
const SERIES_MAP: Record<string, string> = {
	cpi: "CPIAUCSL",
	core_cpi: "CPILFESL",
	pce: "PCEPI",
	unemployment: "UNRATE",
	nonfarm: "PAYEMS",
	gdp: "GDP",
	real_gdp: "GDPC1",
	fed_funds: "FEDFUNDS",
	cpi_yoy: "CPIAUCSL",
	retail_sales: "RSAFS",
	ppi: "PPIACO",
	industrial: "INDPRO",
	m2: "M2SL",
	treasury_10y: "DGS10",
	treasury_2y: "DGS2",
};

// Dashboard entries pair each curated key with its series_id directly (rather
// than looking it up from SERIES_MAP) so both are non-optional strings under
// noUncheckedIndexedAccess.
const DASHBOARD_ENTRIES: { indicator: string; seriesId: string }[] = [
	{ indicator: "cpi", seriesId: "CPIAUCSL" },
	{ indicator: "core_cpi", seriesId: "CPILFESL" },
	{ indicator: "unemployment", seriesId: "UNRATE" },
	{ indicator: "nonfarm", seriesId: "PAYEMS" },
	{ indicator: "gdp", seriesId: "GDP" },
	{ indicator: "fed_funds", seriesId: "FEDFUNDS" },
	{ indicator: "treasury_10y", seriesId: "DGS10" },
	{ indicator: "m2", seriesId: "M2SL" },
];

interface FredObservationRow {
	date?: string;
	value?: string;
}

export interface MacroFetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

function buildUrl(seriesId: string, limit: number, apiKey: string): string {
	const params = new URLSearchParams({
		series_id: seriesId,
		api_key: apiKey,
		file_type: "json",
		sort_order: "desc",
		limit: String(limit),
	});
	return `${FRED_URL}?${params.toString()}`;
}

function normalizeObservations(rows: FredObservationRow[]): MacroObservation[] {
	const observations: MacroObservation[] = [];
	for (const row of rows) {
		if (!row.date || row.value === undefined || row.value === MISSING_VALUE) {
			continue;
		}
		const value = Number(row.value);
		if (Number.isNaN(value)) {
			continue;
		}
		observations.push({ date: row.date, value });
	}
	return observations;
}

async function fetchObservations(
	seriesId: string,
	limit: number,
	apiKey: string,
	opts: MacroFetchOpts
): Promise<MacroObservation[]> {
	const url = buildUrl(seriesId, limit, apiKey);
	const res = await fetchWithRetry(url, undefined, {
		fetchImpl: opts.fetchImpl,
		signal: opts.signal,
	});
	if (!res.ok) {
		throw new Error(`fred HTTP ${res.status}`);
	}
	const json = (await res.json()) as {
		observations?: FredObservationRow[] | null;
	};
	return normalizeObservations(json.observations ?? []);
}

async function fetchDashboardRow(
	indicator: string,
	seriesId: string,
	apiKey: string,
	opts: MacroFetchOpts
): Promise<MacroDashboardRow> {
	try {
		const observations = await fetchObservations(seriesId, 1, apiKey, opts);
		const latest = observations[0];
		return {
			indicator,
			seriesId,
			date: latest?.date ?? null,
			value: latest?.value ?? null,
		};
	} catch {
		return { indicator, seriesId, date: null, value: null };
	}
}

async function getMacroDashboard(
	apiKey: string,
	opts: MacroFetchOpts
): Promise<MacroDashboard> {
	const dashboard = await Promise.all(
		DASHBOARD_ENTRIES.map((entry) =>
			fetchDashboardRow(entry.indicator, entry.seriesId, apiKey, opts)
		)
	);
	return { dashboard };
}

export async function getMacroUs(
	indicator: string | undefined,
	limit: number,
	apiKey: string,
	opts: MacroFetchOpts = {}
): Promise<MacroSeries | MacroDashboard> {
	if (!apiKey) {
		throw new NotConfiguredError("FRED_API_KEY is not set");
	}
	if (!indicator) {
		return getMacroDashboard(apiKey, opts);
	}
	const seriesId = SERIES_MAP[indicator];
	if (!seriesId) {
		return { indicator, seriesId: null, observations: [] };
	}
	const cappedLimit = Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT);
	const observations = await fetchObservations(
		seriesId,
		cappedLimit,
		apiKey,
		opts
	);
	return { indicator, seriesId, observations };
}
