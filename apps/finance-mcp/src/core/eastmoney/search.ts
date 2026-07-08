// East Money A-share stock search via JSONP suggest API.
// NOTE: HTTPS reachability of searchapi.eastmoney.com on the Cloudflare Workers
// TLS stack is to be verified at integration/deploy time (cannot be tested from
// local Node). If the host is unreachable on Workers, swap the host here and
// re-run an integration smoke test against the live endpoint.
import { fetchWithRetry } from "../http";
import type { StockHit } from "../types";
import { parseJsonp } from "./jsonp";

const TOKEN = "D43BF722C8E33BDC906FB84D85E326E8";
const A_CLASSIFY = new Set(["AStock", "23", "NEEQ"]);
const RE_SH = /^(60|68)/;
const RE_SZ = /^(00|30)/;
const RE_BJ = /^(8|4)/;
const RE_6DIGITS = /^\d{6}$/;
const DEFAULT_COUNT = 10;

function exchangeForAShare(code: string): "SH" | "SZ" | "BJ" {
	if (RE_SH.test(code)) {
		return "SH";
	}
	if (RE_SZ.test(code)) {
		return "SZ";
	}
	if (RE_BJ.test(code) || code.startsWith("92")) {
		return "BJ";
	}
	return "SH";
}

interface RawRow {
	Classify?: string;
	Code?: string;
	Name?: string;
}

function isAShareHit(r: RawRow): boolean {
	return (
		Boolean(r.Classify) &&
		A_CLASSIFY.has(r.Classify as string) &&
		RE_6DIGITS.test(r.Code ?? "")
	);
}

function toHit(r: RawRow): StockHit {
	const code = r.Code as string;
	return {
		code,
		market: "a_share",
		exchange: exchangeForAShare(code),
		name: r.Name ?? "",
	};
}

export async function searchAStocks(
	query: string,
	opts: {
		count?: number;
		fetchImpl?: typeof fetch;
		signal?: AbortSignal;
	} = {}
): Promise<StockHit[]> {
	// Must use plain HTTP: searchapi.eastmoney.com has a legacy IIS TLS config
	// that fails the handshake under modern OpenSSL/undici (ECONNRESET before
	// TLS). The endpoint is public read-only, no auth — downgrading TLS for
	// this single call is acceptable. Cloudflare Workers permits outbound
	// http:// subrequests.
	const url =
		"http://searchapi.eastmoney.com/api/suggest/get" +
		`?input=${encodeURIComponent(query)}&type=14&token=${TOKEN}` +
		`&count=${opts.count ?? DEFAULT_COUNT}&cb=jsonp`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://www.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		const text = await res.text();
		const data = parseJsonp<{ QuotationCodeTable?: { Data?: RawRow[] } }>(text);
		const rows = data.QuotationCodeTable?.Data ?? [];
		return rows.filter(isAShareHit).map(toHit);
	} catch {
		return [];
	}
}
