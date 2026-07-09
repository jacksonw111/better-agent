// A-share 股东户数 (shareholder count) time series via EastMoney's
// datacenter-web report API. VERIFIED live during research. Falling 户数 is
// commonly read as 筹码集中 (chip concentration, bullish).
import { fetchWithRetry } from "../http";
import type { HolderCountRow } from "../types-extra";
import { secucode } from "./secucode";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_F10_EH_HOLDERNUM";
const DATE_LENGTH = 10;
const PAGE_SIZE = 12;

interface RawHolderCountRow {
	AVG_FREE_SHARES?: number | null;
	AVG_FREESHARES_RATIO?: number | null;
	END_DATE?: string | null;
	HOLDER_TOTAL_NUM?: number | null;
	TOTAL_NUM_RATIO?: number | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toRow(row: RawHolderCountRow): HolderCountRow {
	return {
		endDate: row.END_DATE ? row.END_DATE.slice(0, DATE_LENGTH) : "",
		totalHolders: orNull(row.HOLDER_TOTAL_NUM),
		changeRatio: orNull(row.TOTAL_NUM_RATIO),
		avgFreeShares: orNull(row.AVG_FREE_SHARES),
		avgFreeSharesRatio: orNull(row.AVG_FREESHARES_RATIO),
	};
}

// A-share only; secucode() throws BadSymbolError for other markets, but a
// non-A symbol here just means "no shareholder-count data" — degrade to []
// rather than propagating the error.
function aShareSecucode(symbol: string): string | null {
	try {
		return secucode(symbol).secucode;
	} catch {
		return null;
	}
}

export async function getHolderCount(
	symbol: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<HolderCountRow[]> {
	const code = aShareSecucode(symbol);
	if (!code) {
		return [];
	}
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
		`&filter=(SECUCODE="${code}")&pageSize=${PAGE_SIZE}&pageNumber=1` +
		"&sortColumns=END_DATE&sortTypes=-1";
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
			result?: { data?: RawHolderCountRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
