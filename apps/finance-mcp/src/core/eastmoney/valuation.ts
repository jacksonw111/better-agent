import { fetchWithRetry } from "../http";
import type { KeyMetrics } from "../types";
import { secucode } from "./secucode";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const DATE_LENGTH = 10;

interface ValuationRow {
	CHANGE_RATE?: number | null;
	CLOSE_PRICE?: number | null;
	FREE_SHARES_A?: number | null;
	NOTLIMITED_MARKETCAP_A?: number | null;
	PB_MRQ?: number | null;
	PCF_OCF_TTM?: number | null;
	PE_LAR?: number | null;
	PE_TTM?: number | null;
	PEG_CAR?: number | null;
	PS_TTM?: number | null;
	TOTAL_MARKET_CAP?: number | null;
	TOTAL_SHARES?: number | null;
	TRADE_DATE?: string | null;
}

// A plain `?? null` per field trips eslint's cyclomatic-complexity cap once
// enough fields pile up, so nullish-coalescing lives here (complexity 2) and
// toMetrics below stays a flat, branch-free object literal (complexity 1).
function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toMetrics(symbol: string, row: ValuationRow): KeyMetrics {
	return {
		symbol,
		tradeDate: row.TRADE_DATE ? row.TRADE_DATE.slice(0, DATE_LENGTH) : null,
		close: orNull(row.CLOSE_PRICE),
		changePct: orNull(row.CHANGE_RATE),
		marketCap: orNull(row.TOTAL_MARKET_CAP),
		floatMarketCap: orNull(row.NOTLIMITED_MARKETCAP_A),
		totalShares: orNull(row.TOTAL_SHARES),
		floatShares: orNull(row.FREE_SHARES_A),
		peTtm: orNull(row.PE_TTM),
		peStatic: orNull(row.PE_LAR),
		pb: orNull(row.PB_MRQ),
		ps: orNull(row.PS_TTM),
		pcf: orNull(row.PCF_OCF_TTM),
		peg: orNull(row.PEG_CAR),
	};
}

export async function getKeyMetrics(
	symbol: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<KeyMetrics | null> {
	const { secucode: code } = secucode(symbol);
	const url =
		`${EM_URL}?reportName=RPT_VALUEANALYSIS_DET&columns=ALL` +
		`&filter=(SECUCODE="${code}")&pageSize=1&pageNumber=1` +
		"&sortColumns=TRADE_DATE&sortTypes=-1";
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as {
			result?: { data?: ValuationRow[] } | null;
		};
		const row = json.result?.data?.[0];
		return row ? toMetrics(symbol, row) : null;
	} catch {
		return null;
	}
}
