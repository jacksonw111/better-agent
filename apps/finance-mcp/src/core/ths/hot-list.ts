// 同花顺热榜 (THS hot list) — one GET returns rank + heat + editorial
// concept tags + rank change for A-share stocks. VERIFIED live during
// research. period "hour" = rolling hot list, "day" = full-day list.
import { fetchWithRetry } from "../http";

const HOT_LIST_URL =
	"https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock";
const STOCK_TYPE = "a";
const LIST_TYPE = "normal";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface RawTag {
	concept_tag?: string[] | null;
	popularity_tag?: string | null;
}

interface RawHotStock {
	code?: string | null;
	hot_rank_chg?: number | string | null;
	name?: string | null;
	order?: number | null;
	rate?: number | string | null;
	rise_and_fall?: number | string | null;
	tag?: RawTag | null;
}

export interface ThsHotRow {
	code: string;
	concepts: string[];
	heat: number;
	name: string;
	pct: number;
	rank: number;
	rankChange: number;
	tag: string;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// `rate` (heat) arrives as a string; other numeric fields vary, so coerce all.
function toNum(value: number | string | null | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

export function toThsHotRow(raw: RawHotStock): ThsHotRow {
	const tag = raw.tag ?? {};
	return {
		rank: toNum(raw.order),
		code: raw.code ?? "",
		name: raw.name ?? "",
		heat: toNum(raw.rate),
		pct: toNum(raw.rise_and_fall),
		rankChange: toNum(raw.hot_rank_chg),
		concepts: tag.concept_tag ?? [],
		tag: tag.popularity_tag ?? "",
	};
}

export async function getThsHotList(
	period: "hour" | "day" = "hour",
	limit: number = DEFAULT_LIMIT,
	opts: FetchOpts = {}
): Promise<ThsHotRow[]> {
	const url = `${HOT_LIST_URL}?stock_type=${STOCK_TYPE}&type=${period}&list_type=${LIST_TYPE}`;
	try {
		const res = await fetchWithRetry(
			url,
			{},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			data?: { stock_list?: RawHotStock[] | null } | null;
		};
		const list = json.data?.stock_list ?? [];
		return list.slice(0, clampLimit(limit)).map(toThsHotRow);
	} catch {
		return [];
	}
}
