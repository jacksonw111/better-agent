// A-share 大宗交易 (block trades) via EastMoney's datacenter-web report API.
// VERIFIED live during research. Market-wide latest by amount, or by symbol.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { BlockTradeRow } from "../types-events";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_DATA_BLOCKTRADE";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;
const PREMIUM_PCT_SCALE = 100;

interface RawBlockTradeRow {
	BUYER_NAME?: string | null;
	DEAL_AMT?: number | null;
	DEAL_PRICE?: number | null;
	DEAL_VOLUME?: number | null;
	PREMIUM_RATIO?: number | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
	SELLER_NAME?: string | null;
	TRADE_DATE?: string | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

// PREMIUM_RATIO arrives as a fraction (e.g. -0.1504) — scale to a proper
// percentage like the rest of the codebase's %-fields.
function toRow(row: RawBlockTradeRow): BlockTradeRow {
	return {
		tradeDate: row.TRADE_DATE ? row.TRADE_DATE.slice(0, DATE_LENGTH) : "",
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		dealPrice: orNull(row.DEAL_PRICE),
		premiumPct:
			row.PREMIUM_RATIO == null ? null : row.PREMIUM_RATIO * PREMIUM_PCT_SCALE,
		dealVolume: orNull(row.DEAL_VOLUME),
		dealAmount: orNull(row.DEAL_AMT),
		buyer: row.BUYER_NAME ?? "",
		seller: row.SELLER_NAME ?? "",
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

export async function getBlockTrades(
	symbol?: string,
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<BlockTradeRow[]> {
	const size = clampLimit(limit);
	try {
		const url =
			`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL${buildFilter(symbol)}` +
			`&pageSize=${size}&pageNumber=1` +
			"&sortColumns=TRADE_DATE,DEAL_AMT&sortTypes=-1,-1";
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawBlockTradeRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
