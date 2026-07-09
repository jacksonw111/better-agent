// A-share 业绩预告 (earnings pre-announcement) via EastMoney's datacenter-web
// report API. VERIFIED live during research. Market-wide latest by default,
// or filtered to one symbol.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { PreannounceRow } from "../types-data";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_PUBLIC_OP_NEWPREDICT";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

interface RawPreannounceRow {
	ADD_AMP_LOWER?: number | null;
	ADD_AMP_UPPER?: number | null;
	CHANGE_REASON_EXPLAIN?: string | null;
	NOTICE_DATE?: string | null;
	PREDICT_CONTENT?: string | null;
	PREDICT_TYPE?: string | null;
	REPORT_DATE?: string | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function safeDate(value: string | null | undefined): string {
	return value ? value.slice(0, DATE_LENGTH) : "";
}

function toRow(row: RawPreannounceRow): PreannounceRow {
	return {
		noticeDate: safeDate(row.NOTICE_DATE),
		reportDate: safeDate(row.REPORT_DATE),
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		type: row.PREDICT_TYPE ?? "",
		changeLower: orNull(row.ADD_AMP_LOWER),
		changeUpper: orNull(row.ADD_AMP_UPPER),
		content: row.PREDICT_CONTENT ?? "",
		reason: row.CHANGE_REASON_EXPLAIN ?? "",
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// Empty/omitted symbol -> market-wide latest (no filter). A given symbol is
// resolved via parseSymbol and filtered by its raw code, even for non-A
// markets — RPT_PUBLIC_OP_NEWPREDICT is A-share only, so a non-A code simply
// yields no rows rather than being rejected.
function buildFilter(symbol: string | undefined): string {
	if (!symbol) {
		return "";
	}
	const { code } = parseSymbol(symbol);
	return `&filter=(SECURITY_CODE="${code}")`;
}

export async function getPreannounce(
	symbol?: string,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<PreannounceRow[]> {
	const size = clampLimit(limit);
	try {
		const url =
			`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL${buildFilter(symbol)}` +
			`&pageSize=${size}&pageNumber=1&sortColumns=NOTICE_DATE&sortTypes=-1`;
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawPreannounceRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
