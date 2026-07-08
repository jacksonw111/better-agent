// East Money sector boards (industry/concept) and their constituents via the
// push2 clist API. The exact response shape is documented but not live
// verified during research, so every step degrades to [] rather than
// throwing: unreachable host, non-OK status, missing/malformed `diff`.
import { fetchWithRetry } from "../http";
import type { SectorConstituent, SectorRow } from "../types";

// The base push2 host 502s on the clist path from Cloudflare egress; the
// numbered mirrors serve it fine (verified live from the Worker).
const CLIST_URL = "https://1.push2.eastmoney.com/api/qt/clist/get";
// EastMoney clist requires this public `ut` token or it returns an empty set.
const CLIST_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const SECTOR_LIST_FIELDS = "f12,f14,f2,f3,f62,f128,f136";
const CONSTITUENT_FIELDS = "f12,f14,f2,f3";
const SECTOR_LIST_PAGE_SIZE = 100;
const CONSTITUENT_PAGE_SIZE = 60;

export type SectorType = "industry" | "concept";

interface ClistRow {
	f2?: number;
	f3?: number;
	f12?: string;
	f14?: string;
	f62?: number;
	f128?: string;
	f136?: number;
}

// `diff` is documented as an array but some EastMoney API versions key it as
// an object by index instead — handle both shapes the same way.
function diffRows(diff: unknown): ClistRow[] {
	if (Array.isArray(diff)) {
		return diff as ClistRow[];
	}
	if (diff && typeof diff === "object") {
		return Object.values(diff as Record<string, ClistRow>);
	}
	return [];
}

function num(value: number | undefined): number {
	return Number.isFinite(value) ? (value as number) : 0;
}

async function fetchClistRows(
	url: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal }
): Promise<ClistRow[]> {
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			data?: { diff?: unknown } | null;
		};
		return diffRows(json.data?.diff);
	} catch {
		return [];
	}
}

function fsForType(type: string): string {
	// EastMoney's selector uses `+` as the space separator (form-encoding); it is
	// embedded literally in the query string (fetch keeps `+`/`:` verbatim).
	return type === "concept" ? "m:90+t:3" : "m:90+t:2";
}

function toSectorRow(row: ClistRow): SectorRow {
	return {
		code: row.f12 ?? "",
		name: row.f14 ?? "",
		price: num(row.f2),
		changePct: num(row.f3),
		mainNet: num(row.f62),
		leadStockCode: row.f128 ?? "",
		leadStockChangePct: num(row.f136),
	};
}

function toConstituent(row: ClistRow): SectorConstituent {
	return {
		code: row.f12 ?? "",
		name: row.f14 ?? "",
		price: num(row.f2),
		changePct: num(row.f3),
	};
}

export async function getSectorList(
	type = "industry",
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<SectorRow[]> {
	const fs = fsForType(type);
	const url =
		`${CLIST_URL}?pn=1&pz=${SECTOR_LIST_PAGE_SIZE}&po=1&np=1&ut=${CLIST_UT}&fltt=2&invt=2` +
		`&fid=f3&fs=${fs}&fields=${SECTOR_LIST_FIELDS}`;
	const rows = await fetchClistRows(url, opts);
	return rows.map(toSectorRow);
}

export async function getSectorConstituents(
	board: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<SectorConstituent[]> {
	const url =
		`${CLIST_URL}?pn=1&pz=${CONSTITUENT_PAGE_SIZE}&po=1&np=1&ut=${CLIST_UT}&fltt=2&invt=2` +
		`&fid=f3&fs=b:${board}&fields=${CONSTITUENT_FIELDS}`;
	const rows = await fetchClistRows(url, opts);
	return rows.map(toConstituent);
}
