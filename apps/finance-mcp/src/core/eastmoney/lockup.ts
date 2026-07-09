// A-share 限售解禁 (lockup expiry) via EastMoney's datacenter-web report API.
// VERIFIED live during research. Symbol given -> full unlock history for
// that stock, newest first. No symbol -> upcoming market-wide unlocks only,
// soonest first.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { LockupRow } from "../types-data";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_LIFT_STAGE";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

interface RawLockupRow {
	FREE_DATE?: string | null;
	FREE_RATIO?: number | null;
	FREE_SHARES?: number | null;
	FREE_SHARES_TYPE?: string | null;
	LIFT_MARKET_CAP?: number | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
}

interface LockupOpts {
	fetchImpl?: typeof fetch;
	now?: number;
	signal?: AbortSignal;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function safeDate(value: string | null | undefined): string {
	return value ? value.slice(0, DATE_LENGTH) : "";
}

function toRow(row: RawLockupRow): LockupRow {
	return {
		freeDate: safeDate(row.FREE_DATE),
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		freeShares: orNull(row.FREE_SHARES),
		freeRatio: orNull(row.FREE_RATIO),
		liftMarketCap: orNull(row.LIFT_MARKET_CAP),
		type: row.FREE_SHARES_TYPE ?? "",
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function buildQuery(symbol: string | undefined, now: number): string {
	if (symbol) {
		const { code } = parseSymbol(symbol);
		return (
			`&filter=(SECURITY_CODE="${code}")` +
			"&sortColumns=FREE_DATE&sortTypes=-1"
		);
	}
	const today = new Date(now).toISOString().slice(0, DATE_LENGTH);
	return `&filter=(FREE_DATE>='${today}')&sortColumns=FREE_DATE&sortTypes=1`;
}

export async function getLockup(
	symbol?: string,
	limit: number = DEFAULT_LIMIT,
	opts: LockupOpts = {}
): Promise<LockupRow[]> {
	const size = clampLimit(limit);
	try {
		const query = buildQuery(symbol, opts.now ?? Date.now());
		const url =
			`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL${query}` +
			`&pageSize=${size}&pageNumber=1`;
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawLockupRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
