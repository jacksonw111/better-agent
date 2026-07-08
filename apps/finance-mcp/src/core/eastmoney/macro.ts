import { fetchWithRetry } from "../http";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const DEFAULT_PAGE_SIZE = 12;

export type MacroCnIndicator = "cpi" | "gdp" | "m2" | "pmi" | "ppi";

const VALID_INDICATORS = new Set<MacroCnIndicator>([
	"cpi",
	"ppi",
	"pmi",
	"gdp",
	"m2",
]);

export type MacroCnRow = Record<string, number | string | null>;

export interface MacroCnSeriesResult {
	indicator: string;
	rows: MacroCnRow[];
}

export interface MacroCnDashboardEntry {
	indicator: MacroCnIndicator;
	latest: MacroCnRow | null;
}

export interface MacroCnDashboardResult {
	dashboard: MacroCnDashboardEntry[];
}

export type MacroCnResult = MacroCnSeriesResult | MacroCnDashboardResult;

interface CnReportField {
	key: string;
	source: string;
	type: "number" | "string";
}

interface CnReportConfig {
	fields: CnReportField[];
	reportName: string;
}

// Verified live: EastMoney datacenter reportName + field maps per indicator.
// m2/m2Yoy have no confirmed field in RPT_ECONOMY_CURRENCY_SUPPLY (columns=ALL
// doesn't expose an unambiguous M2 column) — left null until pinned down.
const REPORTS: Record<MacroCnIndicator, CnReportConfig> = {
	cpi: {
		reportName: "RPT_ECONOMY_CPI",
		fields: [
			{ key: "time", source: "TIME", type: "string" },
			{ key: "yoy", source: "NATIONAL_SAME", type: "number" },
			{ key: "mom", source: "NATIONAL_SEQUENTIAL", type: "number" },
			{ key: "cumulative", source: "NATIONAL_ACCUMULATE", type: "number" },
		],
	},
	ppi: {
		reportName: "RPT_ECONOMY_PPI",
		fields: [
			{ key: "time", source: "TIME", type: "string" },
			{ key: "yoy", source: "BASE_SAME", type: "number" },
			{ key: "cumulative", source: "BASE_ACCUMULATE", type: "number" },
		],
	},
	pmi: {
		reportName: "RPT_ECONOMY_PMI",
		fields: [
			{ key: "time", source: "TIME", type: "string" },
			{ key: "manufacturing", source: "MAKE_INDEX", type: "number" },
			{ key: "nonManufacturing", source: "NMAKE_INDEX", type: "number" },
		],
	},
	gdp: {
		reportName: "RPT_ECONOMY_GDP",
		fields: [
			{ key: "time", source: "TIME", type: "string" },
			{ key: "gdp", source: "DOMESTICL_PRODUCT_BASE", type: "number" },
			{ key: "yoy", source: "SUM_SAME", type: "number" },
		],
	},
	m2: {
		reportName: "RPT_ECONOMY_CURRENCY_SUPPLY",
		fields: [
			{ key: "time", source: "TIME", type: "string" },
			{ key: "m0", source: "BASIC_CURRENCY", type: "number" },
			{ key: "m0Yoy", source: "BASIC_CURRENCY_SAME", type: "number" },
			{ key: "m1", source: "CURRENCY", type: "number" },
			{ key: "m1Yoy", source: "CURRENCY_SAME", type: "number" },
		],
	},
};

const DASHBOARD_INDICATORS: MacroCnIndicator[] = [
	"cpi",
	"ppi",
	"pmi",
	"gdp",
	"m2",
];

export interface MacroCnFetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

function buildUrl(reportName: string, pageSize: number): string {
	const params = new URLSearchParams({
		reportName,
		columns: "ALL",
		pageSize: String(pageSize),
		pageNumber: "1",
		sortColumns: "REPORT_DATE",
		sortTypes: "-1",
	});
	return `${EM_URL}?${params.toString()}`;
}

function mapRow(
	raw: Record<string, unknown>,
	config: CnReportConfig
): MacroCnRow {
	const mapped: MacroCnRow = {};
	for (const field of config.fields) {
		const value = raw[field.source];
		if (field.type === "number") {
			mapped[field.key] = typeof value === "number" ? value : null;
		} else {
			mapped[field.key] = typeof value === "string" ? value : null;
		}
	}
	if (config.reportName === REPORTS.m2.reportName) {
		mapped.m2 = null;
		mapped.m2Yoy = null;
	}
	return mapped;
}

async function fetchRows(
	indicator: MacroCnIndicator,
	pageSize: number,
	opts: MacroCnFetchOpts
): Promise<MacroCnRow[]> {
	const config = REPORTS[indicator];
	const url = buildUrl(config.reportName, pageSize);
	const res = await fetchWithRetry(
		url,
		{ headers: { Referer: "https://data.eastmoney.com/" } },
		{ fetchImpl: opts.fetchImpl, signal: opts.signal }
	);
	if (!res.ok) {
		return [];
	}
	const json = (await res.json()) as {
		result?: { data?: Record<string, unknown>[] } | null;
	};
	const rows = json.result?.data ?? [];
	return rows.map((row) => mapRow(row, config));
}

function isValidIndicator(value: string): value is MacroCnIndicator {
	return VALID_INDICATORS.has(value as MacroCnIndicator);
}

async function fetchLatest(
	indicator: MacroCnIndicator,
	opts: MacroCnFetchOpts
): Promise<MacroCnDashboardEntry> {
	try {
		const rows = await fetchRows(indicator, 1, opts);
		return { indicator, latest: rows[0] ?? null };
	} catch {
		return { indicator, latest: null };
	}
}

async function getMacroCnDashboard(
	opts: MacroCnFetchOpts
): Promise<MacroCnDashboardResult> {
	const dashboard = await Promise.all(
		DASHBOARD_INDICATORS.map((indicator) => fetchLatest(indicator, opts))
	);
	return { dashboard };
}

export async function getMacroCn(
	indicator: string | undefined,
	opts: MacroCnFetchOpts = {}
): Promise<MacroCnResult> {
	if (!indicator) {
		return getMacroCnDashboard(opts);
	}
	if (!isValidIndicator(indicator)) {
		return { indicator, rows: [] };
	}
	try {
		const rows = await fetchRows(indicator, DEFAULT_PAGE_SIZE, opts);
		return { indicator, rows };
	} catch {
		return { indicator, rows: [] };
	}
}
