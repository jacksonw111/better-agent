// A-share top-10 free-float shareholders (十大流通股东) via EastMoney's
// datacenter-web report API. VERIFIED live during research.
import { fetchWithRetry } from "../http";
import type { HolderRow } from "../types-extra";
import { secucode } from "./secucode";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_F10_EH_FREEHOLDERS";
const DATE_LENGTH = 10;
const PAGE_SIZE = 10;
const IS_INSTITUTION_FLAG = "1";

interface RawHolderRow {
	CHANGE_RATIO?: number | null;
	END_DATE?: string | null;
	FREE_HOLDNUM_RATIO?: number | null;
	HOLD_NUM?: number | null;
	HOLD_NUM_CHANGE?: number | null;
	HOLDER_NAME?: string | null;
	HOLDER_RANK?: number | null;
	IS_HOLDORG?: string | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toRow(row: RawHolderRow): HolderRow {
	return {
		endDate: row.END_DATE ? row.END_DATE.slice(0, DATE_LENGTH) : "",
		rank: orNull(row.HOLDER_RANK),
		holder: row.HOLDER_NAME ?? "",
		shares: orNull(row.HOLD_NUM),
		freeFloatRatio: orNull(row.FREE_HOLDNUM_RATIO),
		changeShares: orNull(row.HOLD_NUM_CHANGE),
		changeRatio: orNull(row.CHANGE_RATIO),
		isInstitution: row.IS_HOLDORG === IS_INSTITUTION_FLAG,
	};
}

// Rows can span multiple reporting periods even with pageSize=10 (e.g. ties
// or a thinly-held latest period), so keep only the newest END_DATE and
// re-sort by HOLDER_RANK ascending.
function latestPeriodOnly(rows: RawHolderRow[]): RawHolderRow[] {
	let newest = "";
	for (const row of rows) {
		const end = row.END_DATE ?? "";
		if (end > newest) {
			newest = end;
		}
	}
	return rows
		.filter((row) => (row.END_DATE ?? "") === newest)
		.sort((a, b) => (a.HOLDER_RANK ?? 0) - (b.HOLDER_RANK ?? 0));
}

export async function getTopHolders(
	symbol: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<HolderRow[]> {
	// A-share only; secucode() throws BadSymbolError for other markets.
	const { secucode: code } = secucode(symbol);
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
		`&filter=(SECUCODE="${code}")&pageSize=${PAGE_SIZE}&pageNumber=1` +
		"&sortColumns=END_DATE,HOLDER_RANK&sortTypes=-1,1";
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
			result?: { data?: RawHolderRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return latestPeriodOnly(rows).map(toRow);
	} catch {
		return [];
	}
}
