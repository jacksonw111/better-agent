import { fetchWithRetry } from "../http";
import type { IndexQuote } from "../types";

const INDICES_HOST = "https://qt.gtimg.cn/q=";

type IndexRegion = "cn" | "hk" | "us";

interface IndexCode {
	code: string;
	region: IndexRegion;
}

// Verified live against qt.gtimg.cn full-quote format (same layout as
// core/tencent/quote.ts).
const INDEX_CODES: IndexCode[] = [
	{ region: "cn", code: "sh000001" }, // 上证综指
	{ region: "cn", code: "sz399001" }, // 深证成指
	{ region: "cn", code: "sz399006" }, // 创业板指
	{ region: "cn", code: "sh000300" }, // 沪深300
	{ region: "us", code: "usDJI" }, // 道琼斯
	{ region: "us", code: "usIXIC" }, // 纳斯达克
	{ region: "us", code: "us.INX" }, // 标普500
	{ region: "hk", code: "hkHSI" }, // 恒生指数
];

const LINE_RE = /v_([\w.]+)="([^"]*)"/g;

function num(fields: string[], i: number): number {
	const n = Number(fields[i]);
	return Number.isFinite(n) ? n : 0;
}

function resolveRegion(region: string | undefined): IndexRegion | "all" {
	return region === "cn" || region === "us" || region === "hk" ? region : "all";
}

function codesForRegion(region: IndexRegion | "all"): IndexCode[] {
	return region === "all"
		? INDEX_CODES
		: INDEX_CODES.filter((c) => c.region === region);
}

export function parseIndicesText(
	text: string,
	codes: IndexCode[]
): IndexQuote[] {
	const byCode = new Map(codes.map((c) => [c.code, c]));
	const results: IndexQuote[] = [];
	for (const match of text.matchAll(LINE_RE)) {
		const meta = byCode.get(match[1] ?? "");
		if (!meta) {
			continue;
		}
		const fields = (match[2] ?? "").split("~");
		results.push({
			region: meta.region,
			code: meta.code,
			name: fields[1] ?? "",
			last: num(fields, 3),
			prevClose: num(fields, 4),
			changePct: num(fields, 32),
			high: num(fields, 33),
			low: num(fields, 34),
		});
	}
	return results;
}

export async function getIndices(
	region?: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<IndexQuote[]> {
	const codes = codesForRegion(resolveRegion(region));
	try {
		const res = await fetchWithRetry(
			`${INDICES_HOST}${codes.map((c) => c.code).join(",")}`,
			{ headers: { Referer: "https://gu.qq.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const buf = await res.arrayBuffer();
		const text = new TextDecoder("gbk").decode(buf);
		return parseIndicesText(text, codes);
	} catch {
		return [];
	}
}
