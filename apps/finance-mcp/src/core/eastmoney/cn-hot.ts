// A股股吧人气榜 (EastMoney retail-attention rank) — the CN sentiment proxy.
// VERIFIED live during research. Two legs: (1) POST the rank list from
// EastMoney's app-data endpoint, (2) enrich each code with a live Tencent
// quote (name/last/changePct) via one bulk `qt.gtimg.cn` request.
import { fetchWithRetry } from "../http";
import type { CnHotRow } from "../types-extra";

const RANK_URL = "https://emappdata.eastmoney.com/stockrank/getAllCurrentList";
const QUOTE_HOST = "https://qt.gtimg.cn/q=";
const APP_ID = "appId01";
const GLOBAL_ID = "786e4c21-70dc-435a-93bb-38";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const NAME_FIELD = 1;
const LAST_FIELD = 3;
const CHANGE_PCT_FIELD = 32;
const SC_PREFIX_RE = /^([A-Z]{2})(\d+)$/;
const QUOTE_LINE_RE = /v_([a-z]{2}\d+)="([^"]*)"/g;

interface RawRankRow {
	hisRc?: number | null;
	rk?: number | null;
	sc?: string | null;
}

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export interface TencentQuoteLite {
	changePct: number;
	last: number;
	name: string;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// "SH600519" -> "sh600519"; the market prefix maps 1:1 onto Tencent's
// lower-cased prefix (sh/sz/bj).
function toTencentCode(sc: string): string | null {
	const match = SC_PREFIX_RE.exec(sc);
	if (!match) {
		return null;
	}
	return `${(match[1] ?? "").toLowerCase()}${match[2] ?? ""}`;
}

function num(fields: string[], i: number): number {
	const n = Number(fields[i]);
	return Number.isFinite(n) ? n : 0;
}

// Pure parse: splits a multi-code `qt.gtimg.cn` GBK-decoded response into a
// code -> {name, last, changePct} map. Kept separate from the fetch so tests
// can exercise the parse with real (non-mangled) Chinese text.
export function parseTencentQuotes(
	text: string
): Map<string, TencentQuoteLite> {
	const map = new Map<string, TencentQuoteLite>();
	for (const match of text.matchAll(QUOTE_LINE_RE)) {
		const code = match[1] ?? "";
		const fields = (match[2] ?? "").split("~");
		map.set(code, {
			name: fields[NAME_FIELD] ?? "",
			last: num(fields, LAST_FIELD),
			changePct: num(fields, CHANGE_PCT_FIELD),
		});
	}
	return map;
}

async function fetchRankList(
	limit: number,
	opts: FetchOpts
): Promise<RawRankRow[]> {
	try {
		const res = await fetchWithRetry(
			RANK_URL,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					appId: APP_ID,
					globalId: GLOBAL_ID,
					marketType: "",
					pageNo: 1,
					pageSize: limit,
				}),
			},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as { data?: RawRankRow[] | null };
		return json.data ?? [];
	} catch {
		return [];
	}
}

async function fetchQuoteMap(
	tencentCodes: string[],
	opts: FetchOpts
): Promise<Map<string, TencentQuoteLite>> {
	if (tencentCodes.length === 0) {
		return new Map();
	}
	try {
		const res = await fetchWithRetry(
			`${QUOTE_HOST}${tencentCodes.join(",")}`,
			{ headers: { Referer: "https://gu.qq.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return new Map();
		}
		const buf = await res.arrayBuffer();
		return parseTencentQuotes(new TextDecoder("gbk").decode(buf));
	} catch {
		return new Map();
	}
}

const EMPTY_QUOTE: TencentQuoteLite = { name: "", last: 0, changePct: 0 };

function toCnHotRow(
	row: RawRankRow,
	quoteMap: Map<string, TencentQuoteLite>
): CnHotRow {
	const tencentCode = row.sc ? toTencentCode(row.sc) : null;
	const quote = (tencentCode && quoteMap.get(tencentCode)) || EMPTY_QUOTE;
	return {
		rank: row.rk ?? 0,
		code: tencentCode ? tencentCode.slice(2) : "",
		name: quote.name,
		last: quote.last,
		changePct: quote.changePct,
		rankChange: row.hisRc ?? 0,
	};
}

export async function getCnHot(
	limit: number = DEFAULT_LIMIT,
	opts: FetchOpts = {}
): Promise<CnHotRow[]> {
	const cappedLimit = clampLimit(limit);
	const rankRows = await fetchRankList(cappedLimit, opts);
	if (rankRows.length === 0) {
		return [];
	}
	const tencentCodes: string[] = [];
	for (const row of rankRows) {
		const code = row.sc ? toTencentCode(row.sc) : null;
		if (code) {
			tencentCodes.push(code);
		}
	}
	const quoteMap = await fetchQuoteMap(tencentCodes, opts);
	return rankRows.map((row) => toCnHotRow(row, quoteMap));
}
