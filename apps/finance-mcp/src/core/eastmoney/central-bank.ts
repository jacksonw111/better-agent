import type { CbOp, Market } from "../types";
import { fedOps } from "../us/nyfed";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
// Report name for PBOC open-market operations. Confirm against akshare
// macro_china_open_operation at implementation; keep the normalization stable.
const REPORT_NAME = "RPT_OPEN_MARKET_REPO";
const DATE_LENGTH = 10;

interface OmoRow {
	INTEREST_RATE?: number;
	SECURITY_NAME_ABBR?: string;
	TERM?: string;
	TRADE_DATE?: string;
	VALUE?: number;
}

export async function pbocOps(
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CbOp[]> {
	const doFetch = opts.fetchImpl ?? fetch;
	const url =
		`${EM_URL}?reportName=${REPORT_NAME}&columns=ALL&pageSize=50&pageNumber=1` +
		"&sortColumns=TRADE_DATE&sortTypes=-1";
	try {
		const res = await doFetch(url, {
			headers: { Referer: "https://data.eastmoney.com/" },
			signal: opts.signal,
		});
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as { result?: { data?: OmoRow[] } | null };
		const rows = json.result?.data ?? [];
		return rows
			.filter((r): r is OmoRow & { TRADE_DATE: string } =>
				Boolean(r.TRADE_DATE)
			)
			.map((r) => ({
				date: r.TRADE_DATE.slice(0, DATE_LENGTH),
				type: r.SECURITY_NAME_ABBR ?? "逆回购",
				amount: r.VALUE,
				rate: r.INTEREST_RATE,
				tenor: r.TERM,
			}));
	} catch {
		return [];
	}
}

export function centralBank(
	market: Market,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CbOp[]> {
	return market === "us" ? fedOps(opts) : pbocOps(opts);
}
