import { getKline, type KlinePeriod } from "../tencent/kline";
import type { Candle, TechnicalSnapshot } from "../types";

// Pure technical-indicator math over candle closes/highs/lows. No upstream
// I/O here; getTechnical() below is the only function that fetches.

const MIN_CANDLES = 30;

const MA5 = 5;
const MA10 = 10;
const MA20 = 20;
const MA60 = 60;

const EMA_FAST = 12;
const EMA_SLOW = 26;
const MACD_SIGNAL = 9;

const RSI_PERIOD = 14;
const RSI_MAX = 100;

const KDJ_PERIOD = 9;
const KDJ_SEED = 50;
const KDJ_PREV_WEIGHT = 2 / 3;
const KDJ_NEW_WEIGHT = 1 / 3;
const KDJ_J_D_WEIGHT = 2;
const KDJ_J_K_WEIGHT = 3;

const BOLL_PERIOD = 20;
const BOLL_MULT = 2;

function round(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

export function sma(values: number[], n: number): number | null {
	if (values.length < n) {
		return null;
	}
	const slice = values.slice(-n);
	const sum = slice.reduce((acc, v) => acc + v, 0);
	return sum / n;
}

export function emaSeries(values: number[], n: number): number[] {
	const first = values[0];
	if (first === undefined) {
		return [];
	}
	const k = 2 / (n + 1);
	const series: number[] = [first];
	let prev = first;
	for (let i = 1; i < values.length; i++) {
		const v = values[i];
		if (v === undefined) {
			break;
		}
		const next = v * k + prev * (1 - k);
		series.push(next);
		prev = next;
	}
	return series;
}

export function ema(values: number[], n: number): number | null {
	const series = emaSeries(values, n);
	return series.length > 0 ? (series.at(-1) as number) : null;
}

export function macd(
	closes: number[]
): { dif: number; dea: number; macd: number } | null {
	if (closes.length < EMA_SLOW) {
		return null;
	}
	const fastSeries = emaSeries(closes, EMA_FAST);
	const slowSeries = emaSeries(closes, EMA_SLOW);
	const difSeries = closes.map(
		(_, i) => (fastSeries[i] ?? 0) - (slowSeries[i] ?? 0)
	);
	const deaSeries = emaSeries(difSeries, MACD_SIGNAL);
	const dif = difSeries.at(-1) ?? 0;
	const dea = deaSeries.at(-1) ?? 0;
	return {
		dif: round(dif, 4),
		dea: round(dea, 4),
		macd: round(2 * (dif - dea), 4),
	};
}

export function rsi(closes: number[], n = RSI_PERIOD): number | null {
	if (closes.length < n + 1) {
		return null;
	}
	const recent = closes.slice(-(n + 1));
	let gainSum = 0;
	let lossSum = 0;
	let prev = recent[0] ?? 0;
	for (let i = 1; i < recent.length; i++) {
		const current = recent[i] ?? prev;
		const delta = current - prev;
		if (delta > 0) {
			gainSum += delta;
		} else {
			lossSum += -delta;
		}
		prev = current;
	}
	const avgGain = gainSum / n;
	const avgLoss = lossSum / n;
	if (avgLoss === 0) {
		return RSI_MAX;
	}
	const rs = avgGain / avgLoss;
	return round(RSI_MAX - RSI_MAX / (1 + rs), 2);
}

function kdjRsv(
	closes: number[],
	highs: number[],
	lows: number[],
	i: number,
	n: number
): number {
	const windowHighs = highs.slice(i - n + 1, i + 1);
	const windowLows = lows.slice(i - n + 1, i + 1);
	const highest = Math.max(...windowHighs);
	const lowest = Math.min(...windowLows);
	const denom = highest - lowest;
	const close = closes[i] ?? lowest;
	return denom === 0 ? 0 : ((close - lowest) / denom) * 100;
}

export function kdj(
	closes: number[],
	highs: number[],
	lows: number[],
	n = KDJ_PERIOD
): { k: number; d: number; j: number } | null {
	if (closes.length < n) {
		return null;
	}
	let k = KDJ_SEED;
	let d = KDJ_SEED;
	for (let i = n - 1; i < closes.length; i++) {
		const rsv = kdjRsv(closes, highs, lows, i, n);
		k = KDJ_PREV_WEIGHT * k + KDJ_NEW_WEIGHT * rsv;
		d = KDJ_PREV_WEIGHT * d + KDJ_NEW_WEIGHT * k;
	}
	const j = KDJ_J_K_WEIGHT * k - KDJ_J_D_WEIGHT * d;
	return { k: round(k, 2), d: round(d, 2), j: round(j, 2) };
}

export function boll(
	closes: number[],
	n = BOLL_PERIOD
): { upper: number; mid: number; lower: number } | null {
	const mid = sma(closes, n);
	if (mid === null) {
		return null;
	}
	const slice = closes.slice(-n);
	const variance = slice.reduce((acc, v) => acc + (v - mid) ** 2, 0) / n;
	const std = Math.sqrt(variance);
	return {
		upper: round(mid + BOLL_MULT * std, 2),
		mid: round(mid, 2),
		lower: round(mid - BOLL_MULT * std, 2),
	};
}

export function computeTechnical(candles: Candle[]): TechnicalSnapshot {
	const closes = candles.map((c) => c.close);
	const highs = candles.map((c) => c.high);
	const lows = candles.map((c) => c.low);
	const last = candles.at(-1);
	return {
		symbol: "",
		period: "",
		asOf: last?.time ?? "",
		close: last?.close ?? 0,
		ma5: sma(closes, MA5),
		ma10: sma(closes, MA10),
		ma20: sma(closes, MA20),
		ma60: sma(closes, MA60),
		ema12: ema(closes, EMA_FAST),
		ema26: ema(closes, EMA_SLOW),
		macd: macd(closes),
		rsi14: rsi(closes),
		kdj: kdj(closes, highs, lows),
		boll: boll(closes),
	};
}

export async function getTechnical(
	symbol: string,
	period: KlinePeriod,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<TechnicalSnapshot | null> {
	try {
		const candles = await getKline(symbol, period, 250, opts);
		if (candles.length < MIN_CANDLES) {
			return null;
		}
		return { ...computeTechnical(candles), symbol, period };
	} catch {
		return null;
	}
}
