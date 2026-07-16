// Full-market A-share breadth: advancers/decliners/unchanged + a change-percent
// distribution histogram, combined with the date-accurate limit-up sentiment
// (涨停/跌停/炸板/连板梯队). Fills the "no full-market snapshot" gap — every
// existing finance_* tool is per-symbol.
//
// Two sources, both already proven live in this codebase:
//  1. EastMoney clist (`1.push2.eastmoney.com`, same host/UT as core/eastmoney/
//     sector.ts) for the whole-market change-percent list. NOTE: clist is a
//     REALTIME snapshot — advancers/decliners reflect the latest session, so
//     for an end-of-day 复盘 run it after close on the same trading day.
//  2. getLimitUpSentiment (push2ex, core/eastmoney/limit-up.ts) — date-keyed,
//     so limit-up/down counts and the连板 ladder are correct for a past date.
import { getLimitUpSentiment } from "../eastmoney/limit-up";
import { fetchWithRetry } from "../http";

const CLIST_URL = "https://1.push2.eastmoney.com/api/qt/clist/get";
const CLIST_UT = "bd1d9ddb04089700cf9c27f6f7426281";
// 沪深京 A 股 selector (SH main + STAR, SZ main + ChiNext, BSE). Matches the
// wire format EastMoney's own client sends; encodeFs handles the escaping.
const A_SHARE_FS = "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048";
const FIELDS = "f12,f3";
// The push2 mirror hard-caps each response at 100 rows regardless of `pz`
// (verified live), so the whole market (~5,900 stocks) must be paginated.
// Sort by code (fid=f12) so pages are stable as prices move mid-fetch.
const PAGE_SIZE = 100;
// Safety ceiling: ~8,000 stocks, well above the current A-share universe, so a
// bad `total` can never trigger an unbounded fetch loop.
const MAX_PAGES = 80;
// Fetch remaining pages in bounded-concurrency batches to stay well under the
// upstream's per-IP rate limit while keeping the whole scan within a few
// seconds.
const PAGE_CONCURRENCY = 8;

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface ClistRow {
	f3?: number | string;
}

// Change-percent histogram. Thresholds use 9.8 (not 10) so 20%-cap boards
// (STAR/ChiNext) and rounding don't misclassify near-limit moves; exact
// limit-up/down counts come from the sentiment source instead.
export interface DistributionBuckets {
	down0: number; // (-3, 0)
	down3: number; // (-5, -3]
	down5: number; // (-7, -5]
	down7: number; // (-9.8, -7]
	downLimit: number; // <= -9.8
	flat: number; // == 0
	up0: number; // (0, 3)
	up3: number; // [3, 5)
	up5: number; // [5, 7)
	up7: number; // [7, 9.8)
	upLimit: number; // >= 9.8
}

export interface MarketBreadth {
	advancers: number;
	breakBoard: number;
	breakRatePct: number;
	date: string;
	decliners: number;
	distribution: DistributionBuckets;
	ladder: Record<string, number>;
	limitDown: number;
	limitUp: number;
	maxHeight: number;
	/** Rows with a valid quote (excludes suspended "-" rows). */
	total: number;
	unchanged: number;
}

const NEAR_LIMIT = 9.8;
const PCT_7 = 7;
const PCT_5 = 5;
const PCT_3 = 3;

function toPct(value: number | string | undefined): number | null {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

function emptyBuckets(): DistributionBuckets {
	return {
		upLimit: 0,
		up7: 0,
		up5: 0,
		up3: 0,
		up0: 0,
		flat: 0,
		down0: 0,
		down3: 0,
		down5: 0,
		down7: 0,
		downLimit: 0,
	};
}

function bucketUp(b: DistributionBuckets, pct: number): void {
	if (pct >= NEAR_LIMIT) {
		b.upLimit++;
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

function bucketDown(b: DistributionBuckets, pct: number): void {
	if (pct <= -NEAR_LIMIT) {
		b.downLimit++;
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

// Pure aggregation over change-percent rows, exported for tests.
export function aggregateBreadth(rows: ClistRow[]): {
	advancers: number;
	decliners: number;
	unchanged: number;
	total: number;
	distribution: DistributionBuckets;
} {
	const distribution = emptyBuckets();
	let advancers = 0;
	let decliners = 0;
	let unchanged = 0;
	for (const row of rows) {
		const pct = toPct(row.f3);
		if (pct === null) {
			continue;
		}
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
		decliners,
		unchanged,
		total: advancers + decliners + unchanged,
		distribution,
	};
}

function encodeFs(fs: string): string {
	return encodeURIComponent(fs).replace(/%20/g, "+");
}

function diffRows(diff: unknown): ClistRow[] {
	if (Array.isArray(diff)) {
		return diff as ClistRow[];
	}
	if (diff && typeof diff === "object") {
		return Object.values(diff as Record<string, ClistRow>);
	}
	return [];
}

function pageUrl(pn: number): string {
	return (
		`${CLIST_URL}?pn=${pn}&pz=${PAGE_SIZE}&po=0&np=1&ut=${CLIST_UT}&fltt=2&invt=2` +
		`&fid=f12&fs=${encodeFs(A_SHARE_FS)}&fields=${FIELDS}`
	);
}

interface Page {
	rows: ClistRow[];
	total: number;
}

async function fetchPage(pn: number, opts: Opts): Promise<Page> {
	try {
		const res = await fetchWithRetry(
			pageUrl(pn),
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return { rows: [], total: 0 };
		}
		const json = (await res.json()) as {
			data?: { diff?: unknown; total?: number } | null;
		};
		return {
			rows: diffRows(json.data?.diff),
			total: json.data?.total ?? 0,
		};
	} catch {
		return { rows: [], total: 0 };
	}
}

// Paginates the whole A-share universe: page 1 reveals `total`, the rest are
// fetched in bounded-concurrency batches. Degrades to [] if page 1 is empty.
async function fetchMarketRows(opts: Opts): Promise<ClistRow[]> {
	const first = await fetchPage(1, opts);
	if (first.rows.length === 0) {
		return [];
	}
	const total = first.total || first.rows.length;
	const pageCount = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
	const rows = [...first.rows];
	for (let start = 2; start <= pageCount; start += PAGE_CONCURRENCY) {
		const batch: Promise<Page>[] = [];
		for (
			let pn = start;
			pn < start + PAGE_CONCURRENCY && pn <= pageCount;
			pn++
		) {
			batch.push(fetchPage(pn, opts));
		}
		for (const page of await Promise.all(batch)) {
			rows.push(...page.rows);
		}
	}
	return rows;
}

// date = YYYYMMDD, used for the date-keyed limit-up sentiment; the breadth
// counts themselves come from the realtime clist snapshot.
export async function getMarketBreadth(
	date: string,
	opts: Opts = {}
): Promise<MarketBreadth> {
	const [rows, sentiment] = await Promise.all([
		fetchMarketRows(opts),
		getLimitUpSentiment(date, opts),
	]);
	const agg = aggregateBreadth(rows);
	return {
		date,
		advancers: agg.advancers,
		decliners: agg.decliners,
		unchanged: agg.unchanged,
		total: agg.total,
		limitUp: sentiment.ztCount,
		limitDown: sentiment.dtCount,
		breakBoard: sentiment.zbCount,
		maxHeight: sentiment.maxHeight,
		breakRatePct: sentiment.breakRatePct,
		ladder: sentiment.ladder,
		distribution: agg.distribution,
	};
}
