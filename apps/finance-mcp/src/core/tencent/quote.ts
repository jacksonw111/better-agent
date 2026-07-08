import { parseSymbol } from "../symbol";
import type { DepthLevel, Market, Quote } from "../types";

const QUOTE_HOST = "https://qt.gtimg.cn/q=";

function num(fields: string[], i: number): number {
	const n = Number(fields[i]);
	return Number.isFinite(n) ? n : 0;
}

const DEPTH_LEVELS = 5;
const FIELDS_PER_LEVEL = 2;

function depth(fields: string[], start: number): DepthLevel[] {
	const levels: DepthLevel[] = [];
	for (let i = 0; i < DEPTH_LEVELS; i++) {
		const price = num(fields, start + i * FIELDS_PER_LEVEL);
		const volume = num(fields, start + i * FIELDS_PER_LEVEL + 1);
		if (price > 0) {
			levels.push({ price, volume });
		}
	}
	return levels;
}

export function parseQuote(
	text: string,
	market: Market,
	symbol: string
): Quote {
	const payload = text.split('"')[1] ?? "";
	const fields = payload.split("~");
	return {
		market,
		symbol,
		name: fields[1] ?? "",
		last: num(fields, 3),
		prevClose: num(fields, 4),
		open: num(fields, 5),
		volume: num(fields, 6),
		bids: depth(fields, 9),
		asks: depth(fields, 19),
		time: fields[30] ?? "",
		changePct: num(fields, 32),
		high: num(fields, 33),
		low: num(fields, 34),
	};
}

export async function getQuote(
	symbol: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<Quote> {
	const doFetch = opts.fetchImpl ?? fetch;
	const { market, tencent } = parseSymbol(symbol);
	const res = await doFetch(`${QUOTE_HOST}${tencent}`, {
		headers: { Referer: "https://gu.qq.com/" },
		signal: opts.signal,
	});
	if (!res.ok) {
		throw new Error(`tencent quote HTTP ${res.status}`);
	}
	const buf = await res.arrayBuffer();
	const text = new TextDecoder("gbk").decode(buf);
	return parseQuote(text, market, symbol);
}
