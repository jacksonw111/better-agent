// Full-market US breadth: advancers/decliners/unchanged plus a change-percent
// distribution histogram over every US-listed common stock. Single upstream:
// Nasdaq's screener with `download=true` returns the whole universe
// (NASDAQ + NYSE + AMEX, ~7,000 rows) in ONE response — no pagination —
// including `pctchange` as a "%"-suffixed string. Realtime snapshot: run
// after the close for an end-of-day读数. Same host/UA as core/us/
// nasdaq-earnings.ts. US stocks have no price limits, so unlike the A-share
// breadth there are no limit-up/down counts — the top buckets are open-ended.
import { fetchWithRetry } from "../http";
import { newYorkToday } from "./trade-calendar";

const SCREENER_URL =
	"https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&download=true";
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PCT_10 = 10;
const PCT_7 = 7;
const PCT_5 = 5;
const PCT_3 = 3;
const HALF = 2;
const ROUND_SCALE = 100;

export interface UsDistributionBuckets {
	down0: number; // (-3, 0)
	down3: number; // (-5, -3]
	down5: number; // (-7, -5]
	down7: number; // (-10, -7]
	down10: number; // <= -10
	flat: number; // == 0
	up0: number; // (0, 3)
	up3: number; // [3, 5)
	up5: number; // [5, 7)
	up7: number; // [7, 10)
	up10: number; // >= 10
}

export interface UsMarketBreadth {
	advancers: number;
	/** Snapshot date (America/New_York) — realtime, not date-addressable. */
	date: string;
	decliners: number;
	distribution: UsDistributionBuckets;
	medianChangePct: number | null;
	/** Rows with a parseable change percent (excludes halted/blank rows). */
	total: number;
	unchanged: number;
}

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	/** Injectable snapshot date (`YYYY-MM-DD`) for deterministic tests. */
	today?: string;
}

interface ScreenerRow {
	pctchange?: string | null;
}

// "-0.509%" -> -0.509; "--", "", null -> null (halted / no quote).
export function parsePctChange(
	value: string | null | undefined
): number | null {
	if (!value) {
		return null;
	}
	const n = Number(value.replace("%", ""));
	return Number.isFinite(n) ? n : null;
}

function emptyBuckets(): UsDistributionBuckets {
	return {
		up10: 0,
		up7: 0,
		up5: 0,
		up3: 0,
		up0: 0,
		flat: 0,
		down0: 0,
		down3: 0,
		down5: 0,
		down7: 0,
		down10: 0,
	};
}

function bucketUp(b: UsDistributionBuckets, pct: number): void {
	if (pct >= PCT_10) {
		b.up10++;
	} else if (pct >= PCT_7) {
		b.up7++;
	} else if (pct >= PCT_5) {
		b.up5++;
	} else if (pct >= PCT_3) {
		b.up3++;
	} else {
		b.up0++;
	}
}

function bucketDown(b: UsDistributionBuckets, pct: number): void {
	if (pct <= -PCT_10) {
		b.down10++;
	} else if (pct <= -PCT_7) {
		b.down7++;
	} else if (pct <= -PCT_5) {
		b.down5++;
	} else if (pct <= -PCT_3) {
		b.down3++;
	} else {
		b.down0++;
	}
}

function median(sorted: number[]): number | null {
	if (sorted.length === 0) {
		return null;
	}
	const mid = Math.floor(sorted.length / HALF);
	const value =
		sorted.length % HALF === 0
			? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / HALF
			: (sorted[mid] ?? 0);
	return Math.round(value * ROUND_SCALE) / ROUND_SCALE;
}

// Pure aggregation over screener rows, exported for tests.
export function aggregateUsBreadth(
	rows: ScreenerRow[],
	date: string
): UsMarketBreadth {
	const distribution = emptyBuckets();
	const pcts: number[] = [];
	let advancers = 0;
	let decliners = 0;
	let unchanged = 0;
	for (const row of rows) {
		const pct = parsePctChange(row.pctchange);
		if (pct === null) {
			continue;
		}
		pcts.push(pct);
		if (pct > 0) {
			advancers++;
			bucketUp(distribution, pct);
		} else if (pct < 0) {
			decliners++;
			bucketDown(distribution, pct);
		} else {
			unchanged++;
			distribution.flat++;
		}
	}
	return {
		advancers,
		date,
		decliners,
		distribution,
		medianChangePct: median(pcts.sort((a, b) => a - b)),
		total: pcts.length,
		unchanged,
	};
}

export async function getUsMarketBreadth(
	opts: Opts = {}
): Promise<UsMarketBreadth | null> {
	try {
		const res = await fetchWithRetry(
			SCREENER_URL,
			{ headers: { "User-Agent": UA, Accept: "application/json" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as {
			data?: { rows?: ScreenerRow[] | null } | null;
		};
		const rows = json.data?.rows ?? [];
		if (rows.length === 0) {
			return null;
		}
		return aggregateUsBreadth(rows, opts.today ?? newYorkToday());
	} catch {
		return null;
	}
}
