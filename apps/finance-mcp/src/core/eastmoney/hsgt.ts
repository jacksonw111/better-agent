// Shanghai/Shenzhen-Hong Kong Stock Connect (沪深港通) daily fund flow via
// EastMoney's datacenter-web report API. VERIFIED live during research.
import { fetchWithRetry } from "../http";
import type { HsgtDirection, HsgtRow } from "../types";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_MUTUAL_DEAL_HISTORY";
const DEFAULT_DAYS = 10;
const ROWS_PER_DAY = 5;
const DATE_LENGTH = 10;

// 001=沪股通/北向, 005=深股通/北向, 002=港股通(沪)/南向, 004=港股通(深)/南向,
// 006=南向合计.
const CHANNEL_LABELS: Record<string, string> = {
	"001": "沪股通",
	"005": "深股通",
	"002": "港股通(沪)",
	"004": "港股通(深)",
	"006": "南向合计",
};
const NORTHBOUND_TYPES = new Set(["001", "005"]);

interface MutualDealRow {
	BUY_AMT?: number | null;
	INDEX_CHANGE_RATE?: number | null;
	LEAD_STOCKS_NAME?: string | null;
	MUTUAL_TYPE?: string | null;
	NET_DEAL_AMT?: number | null;
	SELL_AMT?: number | null;
	TRADE_DATE?: string | null;
}

function directionFor(mutualType: string): HsgtDirection {
	return NORTHBOUND_TYPES.has(mutualType) ? "north" : "south";
}

function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toRow(row: MutualDealRow): HsgtRow | null {
	const mutualType = row.MUTUAL_TYPE;
	const tradeDate = row.TRADE_DATE;
	if (!(mutualType && tradeDate)) {
		return null;
	}
	return {
		tradeDate: tradeDate.slice(0, DATE_LENGTH),
		channel: CHANNEL_LABELS[mutualType] ?? mutualType,
		direction: directionFor(mutualType),
		netAmt: orNull(row.NET_DEAL_AMT),
		buyAmt: orNull(row.BUY_AMT),
		sellAmt: orNull(row.SELL_AMT),
		leadStock: orNull(row.LEAD_STOCKS_NAME),
		indexChangeRate: orNull(row.INDEX_CHANGE_RATE),
	};
}

export async function getHsgtFlow(
	days: number = DEFAULT_DAYS,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<HsgtRow[]> {
	const pageSize = Math.max(days, 1) * ROWS_PER_DAY;
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL&pageSize=${pageSize}` +
		"&pageNumber=1&sortColumns=TRADE_DATE&sortTypes=-1";
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
			result?: { data?: MutualDealRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow).filter((r): r is HsgtRow => r !== null);
	} catch {
		return [];
	}
}
