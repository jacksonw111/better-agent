// A-share 高管/股东增减持 (insider buy/sell) via EastMoney's datacenter-web
// report API. VERIFIED live during research. Market-wide latest by default,
// or filtered to one symbol.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { InsiderRow } from "../types-events";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_EXECUTIVE_HOLD_DETAILS";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

interface RawInsiderRow {
	AVERAGE_PRICE?: number | null;
	CHANGE_AMOUNT?: number | null;
	CHANGE_DATE?: string | null;
	CHANGE_RATIO?: number | null;
	CHANGE_REASON?: string | null;
	CHANGE_SHARES?: number | null;
	DSE_PERSON_NAME?: string | null;
	HOLD_TYPE?: string | null;
	PERSON_NAME?: string | null;
	POSITION_NAME?: string | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME?: string | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toRow(row: RawInsiderRow): InsiderRow {
	return {
		changeDate: row.CHANGE_DATE ? row.CHANGE_DATE.slice(0, DATE_LENGTH) : "",
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME ?? "",
		person: row.PERSON_NAME ?? "",
		position: row.POSITION_NAME ?? "",
		holdType: row.HOLD_TYPE ?? "",
		changeShares: orNull(row.CHANGE_SHARES),
		avgPrice: orNull(row.AVERAGE_PRICE),
		changeAmount: orNull(row.CHANGE_AMOUNT),
		changeRatio: orNull(row.CHANGE_RATIO),
		relatedExec: row.DSE_PERSON_NAME ?? "",
		reason: row.CHANGE_REASON ?? "",
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function buildFilter(symbol: string | undefined): string {
	if (!symbol) {
		return "";
	}
	const { code } = parseSymbol(symbol);
	return `&filter=(SECURITY_CODE="${code}")`;
}

export async function getInsiderTrades(
	symbol?: string,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<InsiderRow[]> {
	const size = clampLimit(limit);
	try {
		const url =
			`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL${buildFilter(symbol)}` +
			`&pageSize=${size}&pageNumber=1&sortColumns=CHANGE_DATE&sortTypes=-1`;
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawInsiderRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
