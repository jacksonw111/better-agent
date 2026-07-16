// A-share daily 龙虎榜 (dragon-tiger list, abnormal-trading billboard) via
// EastMoney's datacenter-web report API. VERIFIED live during research.
// Market-wide — no symbol.
import { fetchWithRetry } from "../http";
import type { DragonTigerRow } from "../types-extra";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_DAILYBILLBOARD_DETAILSNEW";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface RawBillboardRow {
	BILLBOARD_DEAL_AMT?: number | null;
	CHANGE_RATE?: number | null;
	CLOSE_PRICE?: number | null;
	EXPLAIN?: string | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
	TRADE_DATE?: string | null;
	TURNOVERRATE?: number | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toRow(row: RawBillboardRow): DragonTigerRow {
	return {
		tradeDate: row.TRADE_DATE ? row.TRADE_DATE.slice(0, DATE_LENGTH) : "",
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		close: orNull(row.CLOSE_PRICE),
		changePct: orNull(row.CHANGE_RATE),
		turnoverRate: orNull(row.TURNOVERRATE),
		billboardAmount: orNull(row.BILLBOARD_DEAL_AMT),
		reason: row.EXPLAIN ?? "",
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// An explicit date filters to that session; empty date omits the filter.
function buildFilter(date: string): string {
	return date ? `&filter=(TRADE_DATE='${date}')` : "";
}

export async function getDragonTiger(
	date: string,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<DragonTigerRow[]> {
	const size = clampLimit(limit);
	// Sort by TRADE_DATE first so an omitted date returns the MOST RECENT
	// session's billboard (not the biggest historical deals — the report spans
	// all history), then by deal amount within the session.
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL${buildFilter(date)}` +
		`&pageSize=${size}&pageNumber=1&sortColumns=TRADE_DATE,BILLBOARD_DEAL_AMT&sortTypes=-1,-1`;
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
			result?: { data?: RawBillboardRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
