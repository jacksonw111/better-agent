// SEC EDGAR XBRL companyfacts (us-gaap): with no metrics requested this
// lists the available metric names; with metrics it extracts the last 20
// annual/quarterly (10-K/10-Q) datapoints per metric, preferring the USD
// unit. Split out of edgar.ts to respect the 300-line-per-file cap.
import type { SecFetchOpts } from "./edgar";
import { secGetJson, tickerToCik } from "./edgar";

const COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts";
const AVAILABLE_METRICS_CAP = 200;
const ENTRIES_CAP = 20;
const PREFERRED_UNIT = "USD";
const WANTED_FORMS = new Set(["10-K", "10-Q"]);

export interface XbrlMetricInfo {
	label: string;
	name: string;
	units: string[];
}

export interface XbrlAvailable {
	availableMetrics: XbrlMetricInfo[];
	company: string;
	totalMetrics: number;
}

export interface XbrlEntry {
	end: string;
	filed: string;
	form: string;
	fp: string;
	fy: number | null;
	val: number | null;
}

export interface XbrlMetrics {
	company: string;
	metrics: Record<string, XbrlEntry[]>;
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

function listAvailable(
	company: string,
	usGaap: Record<string, unknown>
): XbrlAvailable {
	const names = Object.keys(usGaap);
	const availableMetrics = names
		.slice(0, AVAILABLE_METRICS_CAP)
		.map((name): XbrlMetricInfo => {
			const metric = asRecord(usGaap[name]);
			return {
				name,
				label: asString(metric.label) || name,
				units: Object.keys(asRecord(metric.units)),
			};
		});
	return { company, totalMetrics: names.length, availableMetrics };
}

function toEntry(raw: Record<string, unknown>): XbrlEntry {
	return {
		end: asString(raw.end),
		val: asNum(raw.val),
		form: asString(raw.form),
		filed: asString(raw.filed),
		fy: asNum(raw.fy),
		fp: asString(raw.fp),
	};
}

// Prefer the USD unit; otherwise fall back to whichever unit comes first
// (e.g. "USD/shares" for EPS metrics, "shares" for share counts).
function pickUnitEntries(metric: Record<string, unknown>): unknown[] {
	const units = asRecord(metric.units);
	const unitKeys = Object.keys(units);
	const unitKey = unitKeys.includes(PREFERRED_UNIT)
		? PREFERRED_UNIT
		: unitKeys[0];
	if (!unitKey) {
		return [];
	}
	const entries = units[unitKey];
	return Array.isArray(entries) ? entries : [];
}

function extractMetric(metric: Record<string, unknown>): XbrlEntry[] {
	const filtered = pickUnitEntries(metric)
		.map((entry) => asRecord(entry))
		.filter((entry) => WANTED_FORMS.has(asString(entry.form)));
	return filtered.slice(-ENTRIES_CAP).map(toEntry);
}

export async function getXbrlFacts(
	ticker: string,
	metrics: string[],
	opts: SecFetchOpts = {}
): Promise<XbrlAvailable | XbrlMetrics | null> {
	const cik = await tickerToCik(ticker, opts);
	if (!cik) {
		return null;
	}
	const json = await secGetJson(`${COMPANY_FACTS_URL}/CIK${cik}.json`, opts);
	if (json === null || typeof json !== "object") {
		return null;
	}
	const data = json as Record<string, unknown>;
	const company = asString(data.entityName);
	const usGaap = asRecord(asRecord(data.facts)["us-gaap"]);
	if (metrics.length === 0) {
		return listAvailable(company, usGaap);
	}
	const extracted: Record<string, XbrlEntry[]> = {};
	for (const name of metrics) {
		extracted[name] = extractMetric(asRecord(usGaap[name]));
	}
	return { company, metrics: extracted };
}
