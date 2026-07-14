// 同花顺当日强势股归因 — the only free source that pairs each strong stock
// with editorially curated theme tags (`reason`, e.g. "算力租赁+AI政务").
// VERIFIED live during research. NOTE: despite "charset/GBK" in the URL path
// the JSON body is ASCII-escaped unicode, so plain res.json() decodes fine.
import { fetchWithRetry } from "../http";

const STRONG_URL_PREFIX = "http://zx.10jqka.com.cn/event/api/getharden/date/";
const STRONG_URL_SUFFIX = "/orderby/date/orderway/desc/charset/GBK/";
// The endpoint rejects default fetch UAs; a browser UA is required.
const BROWSER_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/117.0.0.0 Safari/537.36";
const OK_ERROCODE = 0;

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface RawStrongStock {
	chengjiaoe?: number | string | null;
	close?: number | string | null;
	code?: string | null;
	ddejingliang?: number | string | null;
	huanshou?: number | string | null;
	market?: string | null;
	name?: string | null;
	reason?: string | null;
	zhangfu?: number | string | null;
}

export interface StrongStockRow {
	amount: number;
	bigOrderNet: number;
	changePct: number;
	close: number;
	code: string;
	market: string;
	name: string;
	reason: string;
	turnoverPct: number;
}

// Numeric fields arrive as strings on some rows; coerce defensively.
function toNum(value: number | string | null | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

export function toStrongStockRow(raw: RawStrongStock): StrongStockRow {
	return {
		code: raw.code ?? "",
		name: raw.name ?? "",
		reason: raw.reason ?? "",
		close: toNum(raw.close),
		changePct: toNum(raw.zhangfu),
		turnoverPct: toNum(raw.huanshou),
		amount: toNum(raw.chengjiaoe),
		bigOrderNet: toNum(raw.ddejingliang),
		market: raw.market ?? "",
	};
}

// date must be "YYYY-MM-DD".
export async function getStrongStocks(
	date: string,
	opts: FetchOpts = {}
): Promise<StrongStockRow[]> {
	const url = `${STRONG_URL_PREFIX}${date}${STRONG_URL_SUFFIX}`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { "User-Agent": BROWSER_UA } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			data?: RawStrongStock[] | null;
			errocode?: number;
		};
		if (json.errocode !== OK_ERROCODE) {
			return [];
		}
		return (json.data ?? []).map(toStrongStockRow);
	} catch {
		return [];
	}
}
