// 指数成分权重 (index constituent weights) via EastMoney's datacenter-web
// report API (RPT_INDEX_TS_COMPONENT). VERIFIED live during research.
// Supports 沪深300/上证50/科创50; any other `index` value falls back to hs300.
import { fetchWithRetry } from "../http";
import type { IndexWeightRow } from "../types-data";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_INDEX_TS_COMPONENT";
const PAGE_SIZE = 500;

const INDEX_TYPE: Record<string, string> = {
	hs300: "1",
	sz50: "2",
	star50: "4",
};
const DEFAULT_TYPE = "1";

interface RawIndexWeightRow {
	CHANGE_RATE?: number | null;
	CLOSE_PRICE?: number | null;
	INDUSTRY?: string | null;
	PE?: number | null;
	ROE?: number | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
	WEIGHT?: number | null;
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toRow(row: RawIndexWeightRow): IndexWeightRow {
	return {
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		weight: orNull(row.WEIGHT),
		closePrice: orNull(row.CLOSE_PRICE),
		changePct: orNull(row.CHANGE_RATE),
		industry: row.INDUSTRY ?? "",
		pe: orNull(row.PE),
		roe: orNull(row.ROE),
	};
}

function typeFor(index: string | undefined): string {
	if (!index) {
		return DEFAULT_TYPE;
	}
	return INDEX_TYPE[index] ?? DEFAULT_TYPE;
}

export async function getIndexWeights(
	index?: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<IndexWeightRow[]> {
	const type = typeFor(index);
	try {
		const url =
			`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL` +
			`&filter=(TYPE="${type}")&sortColumns=WEIGHT&sortTypes=-1` +
			`&pageSize=${PAGE_SIZE}&pageNumber=1`;
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawIndexWeightRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
