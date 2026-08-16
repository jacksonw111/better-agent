// Annual (fiscal-year) series out of SEC XBRL companyfacts: keeps only 10-K
// FY datapoints per concept, trying fallback tag names in order (US-GAAP tag
// usage varies by filer) and deduping by period end on the latest filing.
// Duration facts filed in a 10-K also include quarterly comparatives tagged
// fy/FY, so annual duration entries are additionally length-checked.
import type { SecFetchOpts } from "./edgar";
import { secGetJson, tickerToCik } from "./edgar";

const COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts";
const PREFERRED_UNITS = ["USD", "USD/shares"];
const MS_PER_DAY = 86_400_000;
const ANNUAL_MIN_DAYS = 300;
const ANNUAL_MAX_DAYS = 400;

export interface ConceptSpec {
	key: string;
	tags: string[];
}

export interface AnnualPoint {
	end: string;
	val: number;
}

export interface AnnualFacts {
	company: string;
	series: Record<string, AnnualPoint[]>;
}

interface RawEntry {
	end: string;
	filed: string;
	form: string;
	fp: string;
	start: string;
	val: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asNum(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRawEntry(raw: Record<string, unknown>): RawEntry {
	return {
		end: asString(raw.end),
		filed: asString(raw.filed),
		form: asString(raw.form),
		fp: asString(raw.fp),
		start: asString(raw.start),
		val: asNum(raw.val),
	};
}

function pickUnitEntries(metric: Record<string, unknown>): unknown[] {
	const units = asRecord(metric.units);
	const unitKeys = Object.keys(units);
	const unitKey =
		PREFERRED_UNITS.find((key) => unitKeys.includes(key)) ?? unitKeys[0];
	if (!unitKey) {
		return [];
	}
	const entries = units[unitKey];
	return Array.isArray(entries) ? entries : [];
}

// Instant facts (balance-sheet items) carry no start date; duration facts
// must span roughly a year to exclude quarterly comparatives.
function isAnnualEntry(entry: RawEntry): boolean {
	if (entry.form !== "10-K" || entry.fp !== "FY" || !entry.end) {
		return false;
	}
	if (!entry.start) {
		return true;
	}
	const days = (Date.parse(entry.end) - Date.parse(entry.start)) / MS_PER_DAY;
	return days >= ANNUAL_MIN_DAYS && days <= ANNUAL_MAX_DAYS;
}

function annualSeries(metric: Record<string, unknown>): AnnualPoint[] {
	const byEnd = new Map<string, { filed: string; val: number }>();
	for (const raw of pickUnitEntries(metric)) {
		const entry = toRawEntry(asRecord(raw));
		if (entry.val === null || !isAnnualEntry(entry)) {
			continue;
		}
		const prev = byEnd.get(entry.end);
		if (!prev || entry.filed >= prev.filed) {
			byEnd.set(entry.end, { filed: entry.filed, val: entry.val });
		}
	}
	return [...byEnd.entries()]
		.map(([end, point]) => ({ end, val: point.val }))
		.sort((a, b) => a.end.localeCompare(b.end));
}

// Filers migrate between tags over time (e.g. Apple's Revenues →
// RevenueFromContractWithCustomerExcludingAssessedTax), leaving stale years
// under the old tag — so pick the candidate covering the latest fiscal year,
// not merely the first tag with any data.
function seriesFor(
	usGaap: Record<string, unknown>,
	spec: ConceptSpec
): AnnualPoint[] {
	let best: AnnualPoint[] = [];
	for (const tag of spec.tags) {
		const series = annualSeries(asRecord(usGaap[tag]));
		const lastEnd = series.at(-1)?.end ?? "";
		if (lastEnd > (best.at(-1)?.end ?? "")) {
			best = series;
		}
	}
	return best;
}

export async function getAnnualFacts(
	ticker: string,
	concepts: ConceptSpec[],
	opts: SecFetchOpts = {}
): Promise<AnnualFacts | null> {
	const cik = await tickerToCik(ticker, opts);
	if (!cik) {
		return null;
	}
	const json = await secGetJson(`${COMPANY_FACTS_URL}/CIK${cik}.json`, opts);
	if (json === null || typeof json !== "object") {
		return null;
	}
	const data = json as Record<string, unknown>;
	const usGaap = asRecord(asRecord(data.facts)["us-gaap"]);
	const series: Record<string, AnnualPoint[]> = {};
	for (const spec of concepts) {
		series[spec.key] = seriesFor(usGaap, spec);
	}
	return { company: asString(data.entityName), series };
}
