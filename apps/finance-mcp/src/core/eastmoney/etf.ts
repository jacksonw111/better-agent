// ETF列表 (ETF list) via the push2 clist API, same shape as sector.ts's
// board list but scoped to the all-ETF boards (MK0021-24). The base push2
// host 502s on this path from Cloudflare egress; the numbered mirror serves
// it fine (verified live from the Worker) — see sector.ts for the same note.
import { fetchWithRetry } from "../http";
import type { EtfRow } from "../types-data";

const CLIST_URL = "https://1.push2.eastmoney.com/api/qt/clist/get";
const CLIST_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const ETF_FIELDS = "f12,f14,f2,f3,f5,f6,f8";
const ETF_FS = "b:MK0021,b:MK0022,b:MK0023,b:MK0024";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface EtfClistRow {
	f2?: number;
	f3?: number;
	f5?: number;
	f6?: number;
	f8?: number;
	f12?: string;
	f14?: string;
}

// `diff` is documented as an array but some EastMoney API versions key it as
// an object by index instead — handle both shapes the same way (see
// sector.ts's diffRows for the original pattern).
function diffRows(diff: unknown): EtfClistRow[] {
	if (Array.isArray(diff)) {
		return diff as EtfClistRow[];
	}
	if (diff && typeof diff === "object") {
		return Object.values(diff as Record<string, EtfClistRow>);
	}
	return [];
}

function num(value: number | undefined): number {
	return Number.isFinite(value) ? (value as number) : 0;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function toRow(row: EtfClistRow): EtfRow {
	return {
		code: row.f12 ?? "",
		name: row.f14 ?? "",
		price: num(row.f2),
		changePct: num(row.f3),
		volume: num(row.f5),
		turnover: num(row.f6),
		turnoverRate: num(row.f8),
	};
}

export async function getEtfList(
	limit: number = DEFAULT_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EtfRow[]> {
	const size = clampLimit(limit);
	try {
		const url =
			`${CLIST_URL}?pn=1&pz=${size}&po=1&np=1&ut=${CLIST_UT}&fltt=2&invt=2` +
			`&fid=f3&fs=${ETF_FS}&fields=${ETF_FIELDS}`;
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
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
