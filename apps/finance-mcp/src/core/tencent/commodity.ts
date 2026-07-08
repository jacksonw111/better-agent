import { fetchWithRetry } from "../http";
import type { CommodityQuote } from "../types";

const COMMODITY_HOST = "https://qt.gtimg.cn/q=";

interface CommodityCode {
	code: string;
	key: string;
	name: string;
}

// Verified live: hf_ international-futures format, DIFFERENT field layout
// from the stock/index full-quote format (comma-delimited, not ~).
const COMMODITY_CODES: CommodityCode[] = [
	{ key: "gold", name: "COMEX黄金", code: "hf_GC" },
	{ key: "oil", name: "WTI原油", code: "hf_CL" },
	{ key: "silver", name: "COMEX白银", code: "hf_SI" },
];

const LINE_RE = /v_(hf_\w+)="([^"]*)"/g;

function num(fields: string[], i: number): number {
	const n = Number(fields[i]);
	return Number.isFinite(n) ? n : 0;
}

export function parseCommodityText(text: string): CommodityQuote[] {
	const byCode = new Map(COMMODITY_CODES.map((c) => [c.code, c]));
	const results: CommodityQuote[] = [];
	for (const match of text.matchAll(LINE_RE)) {
		const meta = byCode.get(match[1] ?? "");
		if (!meta) {
			continue;
		}
		const fields = (match[2] ?? "").split(",");
		results.push({
			key: meta.key,
			name: meta.name,
			last: num(fields, 0),
			changePct: num(fields, 1),
			high: num(fields, 4),
			low: num(fields, 5),
			time: fields[6] ?? "",
			prevClose: num(fields, 7),
		});
	}
	return results;
}

export async function getCommodities(
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CommodityQuote[]> {
	try {
		const res = await fetchWithRetry(
			`${COMMODITY_HOST}${COMMODITY_CODES.map((c) => c.code).join(",")}`,
			{ headers: { Referer: "https://gu.qq.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const buf = await res.arrayBuffer();
		const text = new TextDecoder("gbk").decode(buf);
		return parseCommodityText(text);
	} catch {
		return [];
	}
}
