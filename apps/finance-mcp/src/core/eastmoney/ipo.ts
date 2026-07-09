// A-share 新股IPO (IPO application/申购 calendar) via EastMoney's
// datacenter-web report API. VERIFIED live during research. Market-wide —
// no symbol.
import { fetchWithRetry } from "../http";
import type { IpoRow } from "../types-data";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPTA_APP_IPOAPPLY";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

interface RawIpoRow {
	AFTER_ISSUE_PE?: number | null;
	APPLY_CODE?: string | null;
	APPLY_DATE?: string | null;
	INDUSTRY_PE_RATIO?: number | null;
	ISSUE_PRICE?: number | null;
	LISTING_DATE?: string | null;
	MARKET_TYPE_NEW?: string | null;
	ONLINE_APPLY_UPPER?: number | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function safeDate(value: string | null | undefined): string {
	return value ? value.slice(0, DATE_LENGTH) : "";
}

function toRow(row: RawIpoRow): IpoRow {
	return {
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		applyCode: row.APPLY_CODE ?? "",
		applyDate: safeDate(row.APPLY_DATE),
		listingDate: safeDate(row.LISTING_DATE),
		market: row.MARKET_TYPE_NEW ?? "",
		issuePrice: orNull(row.ISSUE_PRICE),
		applyUpper: orNull(row.ONLINE_APPLY_UPPER),
		afterPe: orNull(row.AFTER_ISSUE_PE),
		industryPe: orNull(row.INDUSTRY_PE_RATIO),
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

export async function getIpo(
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<IpoRow[]> {
	const size = clampLimit(limit);
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
		`&pageSize=${size}&pageNumber=1&sortColumns=APPLY_DATE&sortTypes=-1`;
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
			result?: { data?: RawIpoRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
