// A-share dividend & bonus-share history (每10股送转/派息) via EastMoney's
// datacenter-web report API. VERIFIED live during research.
import { fetchWithRetry } from "../http";
import type { DividendRow } from "../types-extra";
import { secucode } from "./secucode";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_SHAREBONUS_DET";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 40;

interface RawDividendRow {
	ASSIGN_PROGRESS?: string | null;
	BONUS_IT_RATIO?: number | null;
	BONUS_RATIO?: number | null;
	EQUITY_RECORD_DATE?: string | null;
	EX_DIVIDEND_DATE?: string | null;
	IMPL_PLAN_PROFILE?: string | null;
	PLAN_NOTICE_DATE?: string | null;
	PRETAX_BONUS_RMB?: number | null;
	REPORT_DATE?: string | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function safeDate(value: string | null | undefined): string {
	return value ? value.slice(0, DATE_LENGTH) : "";
}

function toDividendRow(row: RawDividendRow): DividendRow {
	return {
		reportDate: safeDate(row.REPORT_DATE),
		noticeDate: safeDate(row.PLAN_NOTICE_DATE),
		plan: row.IMPL_PLAN_PROFILE ?? "",
		bonusRatioTransfer: orNull(row.BONUS_IT_RATIO),
		bonusRatioDividend: orNull(row.BONUS_RATIO),
		pretaxDividendRmb: orNull(row.PRETAX_BONUS_RMB),
		recordDate: safeDate(row.EQUITY_RECORD_DATE),
		exDividendDate: safeDate(row.EX_DIVIDEND_DATE),
		progress: row.ASSIGN_PROGRESS ?? "",
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

export async function getDividends(
	symbol: string,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<DividendRow[]> {
	// A-share only; secucode() throws BadSymbolError for other markets.
	const { secucode: fullCode } = secucode(symbol);
	const code = fullCode.split(".")[0];
	const size = clampLimit(limit);
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
		`&filter=(SECURITY_CODE="${code}")&pageSize=${size}&pageNumber=1` +
		"&sortColumns=PLAN_NOTICE_DATE&sortTypes=-1";
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
			result?: { data?: RawDividendRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toDividendRow);
	} catch {
		return [];
	}
}
