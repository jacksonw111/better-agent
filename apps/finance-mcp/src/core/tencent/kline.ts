import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { Candle } from "../types";

export type KlinePeriod =
	| "day"
	| "week"
	| "month"
	| "1m"
	| "5m"
	| "15m"
	| "30m"
	| "60m";

const KLINE_HOST = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
// NOTE: the mkline (intraday minute) endpoint lives on a DIFFERENT host —
// `ifzq.gtimg.cn`, not `web.ifzq.gtimg.cn` (the `web.` host 301-redirects
// for mkline requests).
const MKLINE_HOST = "https://ifzq.gtimg.cn/appstock/app/kline/mkline";
// Tencent's fqkline endpoint returns a null `qfq<period>` (adjusted) series at
// tiny counts, forcing a fallback to the sparse/unadjusted plain `<period>`
// key. Always request a healthy candle count so the adjusted series is
// populated, then slice down to the caller's limit client-side.
const MIN_FETCH = 80;

const MINUTE_PERIODS = new Set<KlinePeriod>(["1m", "5m", "15m", "30m", "60m"]);

function isMinutePeriod(period: KlinePeriod): boolean {
	return MINUTE_PERIODS.has(period);
}

const ALL_PERIODS = new Set<KlinePeriod>([
	"day",
	"week",
	"month",
	...MINUTE_PERIODS,
]);

// Coerces any external (tool-arg / query-string) value into a valid
// KlinePeriod, defaulting to "day". Shared by tools-impl.ts and rest.ts so
// the allow-list lives in exactly one place.
export function coerceKlinePeriod(value: unknown): KlinePeriod {
	return typeof value === "string" && ALL_PERIODS.has(value as KlinePeriod)
		? (value as KlinePeriod)
		: "day";
}

// "5m" -> "5"
function minuteBucket(period: KlinePeriod): string {
	return period.slice(0, -1);
}

function num(v: unknown): number {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : 0;
}

// Row: [date, open, close, high, low, volume]
function rowToCandle(row: unknown[], time: string): Candle | null {
	if (row.length < 6 || !time) {
		return null;
	}
	return {
		time,
		open: num(row[1]),
		close: num(row[2]),
		high: num(row[3]),
		low: num(row[4]),
		volume: num(row[5]),
	};
}

export function parseKline(
	json: unknown,
	tencentCode: string,
	period: KlinePeriod
): Candle[] {
	const data = (json as { data?: Record<string, Record<string, unknown>> })
		.data;
	const node = data?.[tencentCode];
	const rows = node?.[`qfq${period}`] ?? node?.[period];
	if (!Array.isArray(rows)) {
		return [];
	}
	const candles: Candle[] = [];
	for (const row of rows as unknown[][]) {
		const candle = rowToCandle(row, String(row[0] ?? ""));
		if (candle) {
			candles.push(candle);
		}
	}
	return candles;
}

const MINUTE_TIME_LENGTH = 12;

// "202607081500" -> "2026-07-08 15:00"
export function formatMinuteTime(raw: string): string {
	if (raw.length < MINUTE_TIME_LENGTH) {
		return raw;
	}
	const year = raw.slice(0, 4);
	const month = raw.slice(4, 6);
	const day = raw.slice(6, 8);
	const hour = raw.slice(8, 10);
	const minute = raw.slice(10, 12);
	return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function parseMinuteKline(
	json: unknown,
	tencentCode: string,
	period: KlinePeriod
): Candle[] {
	const data = (json as { data?: Record<string, Record<string, unknown>> })
		.data;
	const node = data?.[tencentCode];
	const rows = node?.[`m${minuteBucket(period)}`];
	if (!Array.isArray(rows)) {
		return [];
	}
	const candles: Candle[] = [];
	for (const row of rows as unknown[][]) {
		const time = formatMinuteTime(String(row[0] ?? ""));
		const candle = rowToCandle(row, time);
		if (candle) {
			candles.push(candle);
		}
	}
	return candles;
}

const DEFAULT_LIMIT = 240;
const MAX_LIMIT = 1000;

interface KlineOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

async function fetchMinuteKline(
	tencent: string,
	period: KlinePeriod,
	fetchCount: number,
	opts: KlineOpts
): Promise<Candle[]> {
	const url = `${MKLINE_HOST}?param=${tencent},m${minuteBucket(period)},,${fetchCount}`;
	const res = await fetchWithRetry(url, undefined, {
		fetchImpl: opts.fetchImpl,
		signal: opts.signal,
	});
	if (!res.ok) {
		throw new Error(`tencent mkline HTTP ${res.status}`);
	}
	return parseMinuteKline(await res.json(), tencent, period);
}

async function fetchDayKline(
	tencent: string,
	period: KlinePeriod,
	fetchCount: number,
	opts: KlineOpts
): Promise<Candle[]> {
	const url = `${KLINE_HOST}?param=${tencent},${period},,,${fetchCount},qfq`;
	const res = await fetchWithRetry(url, undefined, {
		fetchImpl: opts.fetchImpl,
		signal: opts.signal,
	});
	if (!res.ok) {
		throw new Error(`tencent kline HTTP ${res.status}`);
	}
	return parseKline(await res.json(), tencent, period);
}

export async function getKline(
	symbol: string,
	period: KlinePeriod,
	limit: number,
	opts: KlineOpts = {}
): Promise<Candle[]> {
	const { tencent } = parseSymbol(symbol);
	const effectiveLimit = limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT;
	const fetchCount = Math.max(effectiveLimit, MIN_FETCH);
	const candles = isMinutePeriod(period)
		? await fetchMinuteKline(tencent, period, fetchCount, opts)
		: await fetchDayKline(tencent, period, fetchCount, opts);
	return limit > 0 ? candles.slice(-effectiveLimit) : candles;
}
