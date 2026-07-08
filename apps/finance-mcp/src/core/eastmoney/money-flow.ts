// East Money individual-stock money-flow (资金流向) via the push2 fflow kline
// API. A-share only. The exact push2 host was IP-blocked during research, so
// this connector is defensive: any non-OK response or parse failure degrades
// to [] rather than throwing.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { MoneyFlowRow } from "../types";

const EM_URL = "https://push2.eastmoney.com/api/qt/stock/fflow/kline/get";
const DEFAULT_DAYS = 5;
const MAX_DAYS = 60;
const MIN_DAYS = 1;

// The server always returns a fixed 5-number CSV after the date regardless
// of the requested fields2, in this order (verified by research arithmetic:
// mainNet = largeNet + superNet; smallNet + mediumNet + largeNet + superNet = 0).
const FIELD_DATE = 0;
const FIELD_MAIN = 1;
const FIELD_SMALL = 2;
const FIELD_MEDIUM = 3;
const FIELD_LARGE = 4;
const FIELD_SUPER = 5;

interface FflowResponse {
	data?: { klines?: string[] } | null;
}

function num(fields: string[], index: number): number {
	const n = Number(fields[index]);
	return Number.isFinite(n) ? n : 0;
}

function toRow(kline: string): MoneyFlowRow | null {
	const fields = kline.split(",");
	const date = fields[FIELD_DATE];
	if (!date) {
		return null;
	}
	return {
		date,
		mainNet: num(fields, FIELD_MAIN),
		smallNet: num(fields, FIELD_SMALL),
		mediumNet: num(fields, FIELD_MEDIUM),
		largeNet: num(fields, FIELD_LARGE),
		superNet: num(fields, FIELD_SUPER),
	};
}

// A-share secid = "1.<code>" (Shanghai) or "0.<code>" (Shenzhen). Returns
// null for non-A-share symbols (this tool is A-share only) or unparseable
// input, so callers can degrade to [] without ever throwing.
function secidForAShare(symbol: string): string | null {
	try {
		const { market, tencent, code } = parseSymbol(symbol);
		if (market !== "a") {
			return null;
		}
		const prefix = tencent.startsWith("sh") ? "1" : "0";
		return `${prefix}.${code}`;
	} catch {
		return null;
	}
}

function clampDays(days: number): number {
	return Math.min(
		Math.max(Math.trunc(days) || DEFAULT_DAYS, MIN_DAYS),
		MAX_DAYS
	);
}

export async function getMoneyFlow(
	symbol: string,
	days: number = DEFAULT_DAYS,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<MoneyFlowRow[]> {
	const secid = secidForAShare(symbol);
	if (!secid) {
		return [];
	}
	const lmt = clampDays(days);
	const url =
		`${EM_URL}?lmt=${lmt}&klt=101&secid=${secid}` +
		"&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56";
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as FflowResponse;
		const klines = json.data?.klines ?? [];
		const rows = klines.map(toRow).filter((r): r is MoneyFlowRow => r !== null);
		rows.sort((a, b) => (a.date < b.date ? 1 : -1));
		return rows;
	} catch {
		return [];
	}
}
