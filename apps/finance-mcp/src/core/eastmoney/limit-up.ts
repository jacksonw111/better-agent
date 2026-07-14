// 打板层 — EastMoney push2ex "topic pool" endpoints: 涨停 (zt) / 炸板 (zb) /
// 跌停 (dt) / 昨日涨停 (yzt). VERIFIED live during research. Raw prices
// (p/ztp) arrive as ×1000 integers and seal times (fbt/lbt/yfbt) as packed
// HHMMSS integers; both are normalised here. On a non-trading day the
// upstream returns `data: null`, which degrades to an empty pool.
import { fetchWithRetry } from "../http";

const BASE_URL = "https://push2ex.eastmoney.com";
const UT = "7eea3edcaed734bea9cbfc24409ed989";
const DPT = "wz.ztzt";
const PAGE_SIZE = 10_000;
const REFERER = "https://quote.eastmoney.com/";
const PRICE_SCALE = 1000;
const TIME_DIGITS = 6;
const PCT_DECIMALS = 2;
const BREAK_RATE_DECIMALS = 1;
const PERCENT = 100;

export type LimitUpPoolKind = "zt" | "zb" | "dt" | "yzt";

const POOL_ENDPOINTS: Record<
	LimitUpPoolKind,
	{ endpoint: string; sort: string }
> = {
	zt: { endpoint: "getTopicZTPool", sort: "fbt:asc" },
	zb: { endpoint: "getTopicZBPool", sort: "fbt:asc" },
	dt: { endpoint: "getTopicDTPool", sort: "fund:asc" },
	yzt: { endpoint: "getYesterdayZTPool", sort: "zs:desc" },
};

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface RawZtStat {
	ct?: number | null;
	days?: number | null;
}

export interface RawPoolItem {
	amount?: number | null;
	c?: string | null;
	days?: number | null;
	fba?: number | null;
	fbt?: number | null;
	fund?: number | null;
	hs?: number | null;
	hybk?: string | null;
	lbc?: number | null;
	lbt?: number | null;
	ltsz?: number | null;
	n?: string | null;
	oc?: number | null;
	p?: number | null;
	pe?: number | null;
	yfbt?: number | null;
	ylbc?: number | null;
	zbc?: number | null;
	zdp?: number | null;
	zf?: number | null;
	zs?: number | null;
	ztp?: number | null;
	zttj?: RawZtStat | null;
}

export interface LimitUpPoolRow {
	amount?: number;
	amplitude?: number;
	boardAmount?: number;
	breakTimes?: number;
	code: string;
	dtDays?: number;
	firstSeal?: string;
	floatCap?: number;
	industry?: string;
	lastSeal?: string;
	limitDays?: number;
	limitPrice?: number;
	name: string;
	openTimes?: number;
	pct: number;
	pe?: number;
	price: number;
	sealFund?: number;
	speed?: number;
	turnover?: number;
	yFirstSeal?: string;
	yLimitDays?: number;
	ztStat?: string;
}

function round(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function num(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Packed HHMMSS integer -> "HH:MM:SS" (92500 -> "09:25:00").
export function formatPoolTime(value: number | null | undefined): string {
	const s = String(num(value)).padStart(TIME_DIGITS, "0");
	return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

function ztStat(raw: RawPoolItem): string {
	return `${raw.zttj?.days ?? "?"}天${raw.zttj?.ct ?? "?"}板`;
}

function baseRow(
	raw: RawPoolItem
): Pick<LimitUpPoolRow, "code" | "name" | "pct" | "price"> {
	return {
		code: raw.c ?? "",
		name: raw.n ?? "",
		price: num(raw.p) / PRICE_SCALE,
		pct: round(num(raw.zdp), PCT_DECIMALS),
	};
}

function parseZt(raw: RawPoolItem): LimitUpPoolRow {
	return {
		...baseRow(raw),
		amount: num(raw.amount),
		floatCap: num(raw.ltsz),
		turnover: round(num(raw.hs), PCT_DECIMALS),
		limitDays: num(raw.lbc),
		firstSeal: formatPoolTime(raw.fbt),
		lastSeal: formatPoolTime(raw.lbt),
		sealFund: num(raw.fund),
		breakTimes: num(raw.zbc),
		industry: raw.hybk ?? "",
		ztStat: ztStat(raw),
	};
}

function parseZb(raw: RawPoolItem): LimitUpPoolRow {
	return {
		...baseRow(raw),
		limitPrice: num(raw.ztp) / PRICE_SCALE,
		turnover: round(num(raw.hs), PCT_DECIMALS),
		firstSeal: formatPoolTime(raw.fbt),
		breakTimes: num(raw.zbc),
		amplitude: round(num(raw.zf), PCT_DECIMALS),
		speed: round(num(raw.zs), PCT_DECIMALS),
		industry: raw.hybk ?? "",
		ztStat: ztStat(raw),
	};
}

function parseDt(raw: RawPoolItem): LimitUpPoolRow {
	return {
		...baseRow(raw),
		turnover: round(num(raw.hs), PCT_DECIMALS),
		pe: num(raw.pe),
		sealFund: num(raw.fund),
		lastSeal: formatPoolTime(raw.lbt),
		boardAmount: num(raw.fba),
		dtDays: num(raw.days),
		openTimes: num(raw.oc),
		industry: raw.hybk ?? "",
	};
}

function parseYzt(raw: RawPoolItem): LimitUpPoolRow {
	return {
		...baseRow(raw),
		turnover: round(num(raw.hs), PCT_DECIMALS),
		amplitude: round(num(raw.zf), PCT_DECIMALS),
		speed: round(num(raw.zs), PCT_DECIMALS),
		yFirstSeal: formatPoolTime(raw.yfbt),
		yLimitDays: num(raw.ylbc),
		industry: raw.hybk ?? "",
		ztStat: ztStat(raw),
	};
}

const PARSERS: Record<LimitUpPoolKind, (raw: RawPoolItem) => LimitUpPoolRow> = {
	zt: parseZt,
	zb: parseZb,
	dt: parseDt,
	yzt: parseYzt,
};

// Pure per-item parse, exported so tests can exercise the field mapping
// (×1000 price scaling, HHMMSS times, zt_stat) without a fetch stub.
export function parseLimitUpPoolItem(
	kind: LimitUpPoolKind,
	raw: RawPoolItem
): LimitUpPoolRow {
	return PARSERS[kind](raw);
}

function poolUrl(kind: LimitUpPoolKind, date: string): string {
	const { endpoint, sort } = POOL_ENDPOINTS[kind];
	const params = new URLSearchParams({
		ut: UT,
		dpt: DPT,
		Pageindex: "0",
		pagesize: String(PAGE_SIZE),
		sort,
		date,
	});
	return `${BASE_URL}/${endpoint}?${params.toString()}`;
}

// date = YYYYMMDD (must be a trading day; otherwise the pool is empty).
export async function getLimitUpPool(
	kind: LimitUpPoolKind,
	date: string,
	opts: FetchOpts = {}
): Promise<LimitUpPoolRow[]> {
	try {
		const res = await fetchWithRetry(
			poolUrl(kind, date),
			{ headers: { Referer: REFERER } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			data?: { pool?: RawPoolItem[] | null } | null;
		};
		const pool = json.data?.pool ?? [];
		return pool.map((raw) => parseLimitUpPoolItem(kind, raw));
	} catch {
		return [];
	}
}

export interface LimitUpSentiment {
	breakRatePct: number;
	date: string;
	dtCount: number;
	ladder: Record<string, number>;
	maxHeight: number;
	zbCount: number;
	ztCount: number;
}

// 打板情绪温度计: ladder = {连板数: 家数}, breakRatePct = zb/(zt+zb)×100.
export async function getLimitUpSentiment(
	date: string,
	opts: FetchOpts = {}
): Promise<LimitUpSentiment> {
	const [zt, zb, dt] = await Promise.all([
		getLimitUpPool("zt", date, opts),
		getLimitUpPool("zb", date, opts),
		getLimitUpPool("dt", date, opts),
	]);
	const ladder: Record<string, number> = {};
	let maxHeight = 0;
	for (const row of zt) {
		const days = row.limitDays ?? 0;
		const key = String(days);
		ladder[key] = (ladder[key] ?? 0) + 1;
		maxHeight = Math.max(maxHeight, days);
	}
	const denominator = zt.length + zb.length;
	const breakRatePct =
		denominator === 0
			? 0
			: round((zb.length / denominator) * PERCENT, BREAK_RATE_DECIMALS);
	return {
		date,
		ztCount: zt.length,
		zbCount: zb.length,
		dtCount: dt.length,
		breakRatePct,
		maxHeight,
		ladder,
	};
}
