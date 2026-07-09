// A-share 可转债 (convertible bond) listing via EastMoney's datacenter-web
// report API. VERIFIED live during research. Market-wide — no symbol.
import { fetchWithRetry } from "../http";
import type { ConvertibleBondRow } from "../types-data";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_BOND_CB_LIST";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface RawConvertibleBondRow {
	ACTUAL_ISSUE_SCALE?: number | null;
	CONVERT_STOCK_CODE?: string | null;
	EXPIRE_DATE?: string | null;
	ISSUE_PRICE?: number | null;
	LISTING_DATE?: string | null;
	RATING?: string | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function safeDate(value: string | null | undefined): string {
	return value ? value.slice(0, DATE_LENGTH) : "";
}

function toRow(row: RawConvertibleBondRow): ConvertibleBondRow {
	return {
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		stockCode: row.CONVERT_STOCK_CODE ?? "",
		rating: row.RATING ?? "",
		listingDate: safeDate(row.LISTING_DATE),
		expireDate: safeDate(row.EXPIRE_DATE),
		issueScale: orNull(row.ACTUAL_ISSUE_SCALE),
		issuePrice: orNull(row.ISSUE_PRICE),
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

export async function getConvertibleBonds(
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<ConvertibleBondRow[]> {
	const size = clampLimit(limit);
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
		`&pageSize=${size}&pageNumber=1&sortColumns=LISTING_DATE&sortTypes=-1`;
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
			result?: { data?: RawConvertibleBondRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
