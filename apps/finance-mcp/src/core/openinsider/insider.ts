// US insider transactions (SEC Form 4) via OpenInsider, the standard free
// aggregator. VERIFIED live during research. Per-ticker screener → the same
// `tinytable` the site renders, parsed with regex (no DOM in the Worker).
// HK insider has no clean free source, so this is US-only; the skill notes it.
// Degrades to [] on any fetch/parse failure.
import { fetchWithRetry } from "../http";

const BASE = "http://openinsider.com/screener";
const DEFAULT_DAYS = 365;
const MAX_DAYS = 1460;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// tinytable column indices (0-based <td>): see headers X | Filing | Trade |
// Ticker | Insider | Title | TradeType | Price | Qty | Owned | ΔOwn | Value.
const COL = {
	filingDate: 1,
	tradeDate: 2,
	insider: 4,
	title: 5,
	tradeType: 6,
	price: 7,
	qty: 8,
	owned: 9,
	deltaOwn: 10,
	value: 11,
} as const;

export interface UsInsiderRow {
	/** Ownership change %, as reported (string, e.g. "-12%"). */
	deltaOwn: string;
	filingDate: string;
	insider: string;
	price: number | null;
	/** Signed share count (+buy / −sell). */
	qty: number | null;
	/** Derived: "buy" (P) / "sell" (S) / "other". */
	side: "buy" | "sell" | "other";
	title: string;
	tradeDate: string;
	/** Raw OpenInsider trade type, e.g. "P - Purchase", "S - Sale+OE". */
	tradeType: string;
	/** Signed dollar value. */
	value: number | null;
}

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

const TAG_RE = /<[^>]+>/g;
const TABLE_RE = /<table[^>]*tinytable[^>]*>([\s\S]*?)<\/table>/i;
const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<td[^>]*>([\s\S]*?)<\/td>/gi;

function clean(html: string): string {
	return html
		.replace(TAG_RE, "")
		.replace(/&nbsp;/g, " ")
		.replace(/ /g, " ")
		.trim();
}

function toNumber(text: string): number | null {
	const cleaned = text.replace(/[$,%\s]/g, "");
	if (cleaned === "" || cleaned === "-") {
		return null;
	}
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
}

function sideOf(tradeType: string): UsInsiderRow["side"] {
	const head = tradeType.trim().charAt(0).toUpperCase();
	if (head === "P") {
		return "buy";
	}
	if (head === "S") {
		return "sell";
	}
	return "other";
}

function cellsOf(rowHtml: string): string[] {
	const cells: string[] = [];
	CELL_RE.lastIndex = 0;
	let m = CELL_RE.exec(rowHtml);
	while (m !== null) {
		cells.push(clean(m[1] ?? ""));
		m = CELL_RE.exec(rowHtml);
	}
	return cells;
}

function toRow(cells: string[]): UsInsiderRow | null {
	if (cells.length <= COL.value) {
		return null;
	}
	// cell() returns "" for a missing index, so the mapping has no `??` branches
	// (keeps cyclomatic complexity under the lint gate).
	const cell = (i: number): string => cells[i] ?? "";
	const tradeType = cell(COL.tradeType);
	return {
		filingDate: cell(COL.filingDate).split(" ")[0] ?? "",
		tradeDate: cell(COL.tradeDate),
		insider: cell(COL.insider),
		title: cell(COL.title),
		tradeType,
		side: sideOf(tradeType),
		price: toNumber(cell(COL.price)),
		qty: toNumber(cell(COL.qty)),
		value: toNumber(cell(COL.value)),
		deltaOwn: cell(COL.deltaOwn),
	};
}

// Pure parse over the screener HTML, exported for tests.
export function parseInsiderHtml(html: string, limit: number): UsInsiderRow[] {
	const table = html.match(TABLE_RE)?.[1];
	if (!table) {
		return [];
	}
	const rows: UsInsiderRow[] = [];
	ROW_RE.lastIndex = 0;
	let m = ROW_RE.exec(table);
	while (m !== null && rows.length < limit) {
		const cells = cellsOf(m[1] ?? "");
		if (cells.length > 0) {
			const row = toRow(cells);
			if (row) {
				rows.push(row);
			}
		}
		m = ROW_RE.exec(table);
	}
	return rows;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function clampDays(days: number): number {
	if (!Number.isFinite(days) || days <= 0) {
		return DEFAULT_DAYS;
	}
	return Math.min(Math.floor(days), MAX_DAYS);
}

// ticker required (US). Returns recent insider transactions newest-first.
export async function getUsInsider(
	ticker: string,
	limit: number = DEFAULT_LIMIT,
	days: number = DEFAULT_DAYS,
	opts: Opts = {}
): Promise<UsInsiderRow[]> {
	const symbol = ticker.trim().toUpperCase();
	if (!symbol) {
		return [];
	}
	const size = clampLimit(limit);
	const params = new URLSearchParams({
		s: symbol,
		fd: String(clampDays(days)),
		td: "0",
		xp: "1",
		xs: "1",
		nrows: String(size),
	});
	try {
		const res = await fetchWithRetry(
			`${BASE}?${params.toString()}`,
			{ headers: { "User-Agent": "Mozilla/5.0" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		return parseInsiderHtml(await res.text(), size);
	} catch {
		return [];
	}
}
