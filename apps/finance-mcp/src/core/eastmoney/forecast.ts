// East Money earnings consensus forecast.
//
// SOURCE STRATEGY: derive from getStockResearch predict* EPS/PE fields.
// The datacenter-web RPT_WEB_RESPREDICT endpoint was evaluated live but
// returns inconsistent/empty rows for many stocks; the research-report
// predict* fields are reliable and already fetched. We average epsY0/Y1/Y2
// and peY0/Y1/Y2 across the most-recent research reports (up to 10) to form
// a 3-row consensus table keyed by relative year offset (0 = this FY,
// 1 = next FY, 2 = FY+2). The `year` label is a calendar string derived
// from the current year + offset.
import { parseSymbol } from "../symbol";
import type { ForecastRow, ResearchReport } from "../types";
import { fetchResearchReportsForCode, type ResearchOpts } from "./research";

const MAX_REPORTS_FOR_CONSENSUS = 10;
const FORECAST_YEARS_WINDOW = 1;
const AVERAGE_ROUND_FACTOR = 100;

function average(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	const sum = values.reduce((acc, v) => acc + v, 0);
	return (
		Math.round((sum / values.length) * AVERAGE_ROUND_FACTOR) /
		AVERAGE_ROUND_FACTOR
	);
}

function collectNonNull(
	reports: ResearchReport[],
	key: keyof Pick<
		ResearchReport,
		"epsY0" | "epsY1" | "epsY2" | "peY0" | "peY1" | "peY2"
	>
): number[] {
	const result: number[] = [];
	for (const r of reports) {
		const v = r[key];
		if (v !== null && v !== undefined) {
			result.push(v);
		}
	}
	return result;
}

function buildForecastRows(
	reports: ResearchReport[],
	baseYear: number
): ForecastRow[] {
	const recent = reports.slice(0, MAX_REPORTS_FOR_CONSENSUS);
	return [
		{
			year: String(baseYear),
			eps: average(collectNonNull(recent, "epsY0")),
			pe: average(collectNonNull(recent, "peY0")),
		},
		{
			year: String(baseYear + 1),
			eps: average(collectNonNull(recent, "epsY1")),
			pe: average(collectNonNull(recent, "peY1")),
		},
		{
			year: String(baseYear + 2),
			eps: average(collectNonNull(recent, "epsY2")),
			pe: average(collectNonNull(recent, "peY2")),
		},
	];
}

// A-share-only, like getStockResearch(): degrades to [] for other markets
// rather than throwing, since there's no equivalent consensus source to
// fall back to for HK/US symbols.
export async function getEarningsForecast(
	symbol: string,
	opts: ResearchOpts = {}
): Promise<ForecastRow[]> {
	const { market, code } = parseSymbol(symbol);
	if (market !== "a") {
		return [];
	}
	try {
		const nowMs = opts.now ?? Date.now();
		const baseYear = new Date(nowMs).getFullYear();
		const reports = await fetchResearchReportsForCode(code, {
			...opts,
			now: nowMs,
			years: FORECAST_YEARS_WINDOW,
		});
		if (reports.length === 0) {
			return [];
		}
		return buildForecastRows(reports, baseYear);
	} catch {
		return [];
	}
}
