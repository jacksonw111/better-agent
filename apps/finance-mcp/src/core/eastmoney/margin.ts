// A-share margin trading (融资融券) history via EastMoney's datacenter-web
// report API. VERIFIED live during research.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { MarginRow } from "../types-extra";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPTA_WEB_RZRQ_GGMX";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 60;

interface RawMarginRow {
	DATE?: string | null;
	RQMCL?: number | null;
	RQYE?: number | null;
	RQYL?: number | null;
	RZMRE?: number | null;
	RZRQYE?: number | null;
	RZYE?: number | null;
	RZYEZB?: number | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function safeDate(value: string | null | undefined): string {
	return value ? value.slice(0, DATE_LENGTH) : "";
}

function toMarginRow(row: RawMarginRow): MarginRow {
	return {
		date: safeDate(row.DATE),
		financingBalance: orNull(row.RZYE),
		financingBuy: orNull(row.RZMRE),
		securitiesBalance: orNull(row.RQYE),
		securitiesVolume: orNull(row.RQYL),
		totalBalance: orNull(row.RZRQYE),
		financingBalanceRatio: orNull(row.RZYEZB),
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// A-share only; non-A symbols (and unparsable input) degrade to [] rather
// than throwing, since margin trading has no equivalent on other markets.
function aShareCode(symbol: string): string | null {
	try {
		const parsed = parseSymbol(symbol);
		return parsed.market === "a" ? parsed.code : null;
	} catch {
		return null;
	}
}

export async function getMargin(
	symbol: string,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<MarginRow[]> {
	const code = aShareCode(symbol);
	if (!code) {
		return [];
	}
	const size = clampLimit(limit);
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
		`&filter=(scode="${code}")&pageSize=${size}&pageNumber=1` +
		"&sortColumns=date&sortTypes=-1";
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
			result?: { data?: RawMarginRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toMarginRow);
	} catch {
		return [];
	}
}
