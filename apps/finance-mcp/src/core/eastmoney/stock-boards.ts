// 个股所属板块/概念归属 (board/concept membership for a single stock) via
// push2's `slist/get` with spt=3 — one request returns every board the stock
// belongs to (industry + concept + region mixed; board names are
// self-explanatory). Replaces the dead Baidu getrelatedblock source.
import { fetchWithRetry } from "../http";

const SLIST_URL = "https://push2.eastmoney.com/api/qt/slist/get";
const BOARD_FIELDS = "f12,f14,f3,f128";
const PAGE_SIZE = 200;
const SH_MARKET = 1;
const SZ_MARKET = 0;
const BARE_CODE_RE = /^\d{6}$/;
const LETTER_PREFIX_RE = /^[A-Za-z]+/;

export interface BoardRow {
	changePct: number;
	code: string;
	leadStock: string;
	name: string;
}

export interface StockBoards {
	boards: BoardRow[];
	conceptTags: string[];
	total: number;
}

interface SlistRow {
	f3?: number | string;
	f12?: string;
	f14?: string;
	f128?: string;
}

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

const EMPTY: StockBoards = { total: 0, boards: [], conceptTags: [] };

// Accepts "600519", "600519.SH", "SH600519", "sh600519" — returns the bare
// 6-digit code, or null when no 6-digit run is present.
function normalizeCode(input: string): string | null {
	const stripped = input.trim().split(".")[0] ?? "";
	const bare = stripped.replace(LETTER_PREFIX_RE, "");
	return BARE_CODE_RE.test(bare) ? bare : null;
}

// `diff` is documented as an array but some EastMoney API versions key it as
// an object by index instead — handle both shapes (see options.ts/sector.ts).
function diffRows(diff: unknown): SlistRow[] {
	if (Array.isArray(diff)) {
		return diff as SlistRow[];
	}
	if (diff && typeof diff === "object") {
		return Object.values(diff as Record<string, SlistRow>);
	}
	return [];
}

function num(value: number | string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function toBoardRow(row: SlistRow): BoardRow {
	return {
		name: row.f14 ?? "",
		code: row.f12 ?? "",
		changePct: num(row.f3),
		leadStock: row.f128 ?? "",
	};
}

export async function getStockBoards(
	code: string,
	opts: FetchOpts = {}
): Promise<StockBoards> {
	const bare = normalizeCode(code);
	if (!bare) {
		return EMPTY;
	}
	const market = bare.startsWith("6") ? SH_MARKET : SZ_MARKET;
	const url =
		`${SLIST_URL}?fltt=2&invt=2&secid=${market}.${bare}` +
		`&spt=3&pi=0&pz=${PAGE_SIZE}&po=1&fields=${BOARD_FIELDS}`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://quote.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return EMPTY;
		}
		const json = (await res.json()) as { data?: { diff?: unknown } | null };
		const boards = diffRows(json.data?.diff).map(toBoardRow);
		return {
			total: boards.length,
			boards,
			conceptTags: boards.map((b) => b.name),
		};
	} catch {
		return EMPTY;
	}
}
