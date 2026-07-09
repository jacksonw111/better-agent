// 期权链 (ETF option chain) via push2's `slist/get` endpoint — NOT the
// `clist/get` used elsewhere (verified live during research: slist is not
// blocked, unlike the base clist host). Covers the 50/300/500 ETF option
// underlyings. Greeks/IV aren't in this feed (paid data on EastMoney).
import { fetchWithRetry } from "../http";
import type { OptionRow } from "../types-data";

const SLIST_URL = "https://push2.eastmoney.com/api/qt/slist/get";
const OPTION_FIELDS = "f12,f14,f2,f3,f108,f152";
const PAGE_SIZE = 60;
const CALL_KIND_CODE = 2;
const STRIKE_DIVISOR = 1000;

const UNDERLYING_SECID: Record<string, string> = {
	"300etf": "1.510300",
	"50etf": "1.510050",
	"500etf": "1.510500",
};
const DEFAULT_SECID = "1.510300";

interface SlistRow {
	f2?: number;
	f3?: number;
	f12?: string;
	f14?: string;
	f108?: number;
	f152?: number;
}

// `diff` is documented as an array but some EastMoney API versions key it as
// an object by index instead — handle both shapes the same way (see
// sector.ts's diffRows for the original pattern).
function diffRows(diff: unknown): SlistRow[] {
	if (Array.isArray(diff)) {
		return diff as SlistRow[];
	}
	if (diff && typeof diff === "object") {
		return Object.values(diff as Record<string, SlistRow>);
	}
	return [];
}

function num(value: number | undefined): number {
	return Number.isFinite(value) ? (value as number) : 0;
}

// Contract names embed the strike as a trailing digit run, e.g.
// "300ETF购7月4000" -> 4000 -> 4.000. No trailing digits -> null.
const TRAILING_DIGITS = /(\d+)(?!.*\d)/;

function parseStrike(name: string): number | null {
	const match = name.match(TRAILING_DIGITS);
	if (!match) {
		return null;
	}
	return Number(match[1]) / STRIKE_DIVISOR;
}

function secidFor(underlying: string | undefined): string {
	if (!underlying) {
		return DEFAULT_SECID;
	}
	return UNDERLYING_SECID[underlying] ?? DEFAULT_SECID;
}

function toRow(row: SlistRow): OptionRow {
	const name = row.f14 ?? "";
	return {
		code: row.f12 ?? "",
		name,
		last: num(row.f2),
		changePct: num(row.f3),
		volume: num(row.f108),
		kind: row.f152 === CALL_KIND_CODE ? "call" : "put",
		strike: parseStrike(name),
	};
}

export async function getOptionChain(
	underlying?: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<OptionRow[]> {
	const secid = secidFor(underlying);
	try {
		const url =
			`${SLIST_URL}?spt=9&fltt=2&fid=f3&pi=0&po=1&pz=${PAGE_SIZE}` +
			`&fields=${OPTION_FIELDS}&secid=${secid}`;
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://quote.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as { data?: { diff?: unknown } | null };
		return diffRows(json.data?.diff).map(toRow);
	} catch {
		return [];
	}
}
