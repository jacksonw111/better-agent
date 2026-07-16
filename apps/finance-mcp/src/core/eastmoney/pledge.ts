// A-share 股权质押 (share pledge) via EastMoney's datacenter-web report API
// (RPT_CSDC_LIST — 中登公司结算数据). VERIFIED live during research. Given a
// symbol, returns that stock's pledge-ratio history newest-first, one row per
// settlement date.
//
// CAVEAT: this is 中登 (CSDC) weekly settlement data whose public disclosure
// slowed markedly — the latest available rows can lag the market by a long
// window (observed latest ≈ 2024-04 during research). Always read the returned
// TRADE_DATE as the as-of date; never present it as current.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_CSDC_LIST";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 60;

interface RawPledgeRow {
	INDUSTRY?: string | null;
	PLEDGE_DEAL_NUM?: number | null;
	PLEDGE_MARKET_CAP?: number | null;
	PLEDGE_RATIO?: number | null;
	REPURCHASE_BALANCE?: number | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
	TRADE_DATE?: string | null;
}

export interface PledgeRow {
	code: string;
	/** Settlement (as-of) date, `YYYY-MM-DD`. */
	date: string;
	industry: string;
	name: string;
	/** 质押笔数. */
	pledgeDealNum: number | null;
	/** 质押市值 (EastMoney unit, 万元). */
	pledgeMarketCap: number | null;
	/** 质押比例 %: pledged shares as a share of total shares. */
	pledgeRatio: number | null;
	/** 待购回余额. */
	repurchaseBalance: number | null;
}

interface PledgeOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function safeDate(value: string | null | undefined): string {
	return value ? value.slice(0, DATE_LENGTH) : "";
}

function toRow(row: RawPledgeRow): PledgeRow {
	return {
		date: safeDate(row.TRADE_DATE),
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		pledgeRatio: orNull(row.PLEDGE_RATIO),
		pledgeDealNum: orNull(row.PLEDGE_DEAL_NUM),
		pledgeMarketCap: orNull(row.PLEDGE_MARKET_CAP),
		repurchaseBalance: orNull(row.REPURCHASE_BALANCE),
		industry: row.INDUSTRY ?? "",
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// Pure parse over the report payload, exported for tests.
export function parsePledgeRows(json: unknown): PledgeRow[] {
	const rows =
		(json as { result?: { data?: RawPledgeRow[] } | null }).result?.data ?? [];
	return rows.map(toRow);
}

// symbol required (A-share). Returns the stock's pledge history newest-first.
export async function getSharePledge(
	symbol: string,
	limit: number = DEFAULT_LIMIT,
	opts: PledgeOpts = {}
): Promise<PledgeRow[]> {
	const { code } = parseSymbol(symbol);
	if (!code) {
		return [];
	}
	const size = clampLimit(limit);
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
		`&filter=(SECURITY_CODE="${code}")&sortColumns=TRADE_DATE&sortTypes=-1` +
		`&pageSize=${size}&pageNumber=1`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		return parsePledgeRows(await res.json());
	} catch {
		return [];
	}
}
