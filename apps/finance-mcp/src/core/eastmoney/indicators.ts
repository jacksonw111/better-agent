import { fetchWithRetry } from "../http";
import type { IndicatorRow } from "../types";
import { secucode } from "./secucode";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const DATE_LENGTH = 10;
const DEFAULT_PERIODS = 8;
const MAX_PERIODS = 40;

interface RawRow {
	BPS?: number | null;
	EPSJB?: number | null;
	MGJYXJJE?: number | null;
	PARENTNETPROFIT?: number | null;
	PARENTNETPROFITTZ?: number | null;
	REPORT_DATE?: string | null;
	REPORT_DATE_NAME?: string | null;
	ROEJQ?: number | null;
	ROEKCJQ?: number | null;
	TOTALOPERATEREVE?: number | null;
	TOTALOPERATEREVETZ?: number | null;
	XSJLL?: number | null;
	XSMLL?: number | null;
	ZCFZL?: number | null;
}

function clampPeriods(periods: number): number {
	if (!Number.isFinite(periods) || periods <= 0) {
		return DEFAULT_PERIODS;
	}
	return Math.min(Math.floor(periods), MAX_PERIODS);
}

// See valuation.ts's orNull comment: routing every `?? null` through this
// helper keeps toIndicatorRow itself branch-free (complexity 1) under the cap.
function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toIndicatorRow(r: RawRow): IndicatorRow {
	const reportDate = r.REPORT_DATE ? r.REPORT_DATE.slice(0, DATE_LENGTH) : "";
	return {
		reportDate,
		reportName: orNull(r.REPORT_DATE_NAME),
		eps: orNull(r.EPSJB),
		bps: orNull(r.BPS),
		revenue: orNull(r.TOTALOPERATEREVE),
		revenueYoy: orNull(r.TOTALOPERATEREVETZ),
		netProfit: orNull(r.PARENTNETPROFIT),
		netProfitYoy: orNull(r.PARENTNETPROFITTZ),
		grossMargin: orNull(r.XSMLL),
		netMargin: orNull(r.XSJLL),
		roe: orNull(r.ROEJQ),
		roeDeducted: orNull(r.ROEKCJQ),
		debtRatio: orNull(r.ZCFZL),
		opCashPerShare: orNull(r.MGJYXJJE),
	};
}

export async function getFinancialIndicators(
	symbol: string,
	periods: number,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<IndicatorRow[]> {
	const { secucode: code } = secucode(symbol);
	const size = clampPeriods(periods);
	const url =
		`${EM_URL}?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL` +
		`&filter=(SECUCODE="${code}")&pageSize=${size}&pageNumber=1` +
		"&sortColumns=REPORT_DATE&sortTypes=-1";
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toIndicatorRow);
	} catch {
		return [];
	}
}
