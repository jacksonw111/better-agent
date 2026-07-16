// Historical / realized volatility (年化 HV) computed from daily kline — the
// missing half of an options-vol view: option tools already surface IV
// (finance_option_quote / finance_us_options), and IV vs this HV is the
// volatility-premium signal. Self-contained: reuses the Tencent kline feed,
// no new upstream. Works for any symbol with a daily series (A/HK/US).
import { getKline } from "../tencent/kline";

const TRADING_DAYS = 252;
const WINDOWS = [20, 60, 120, 250] as const;
// Rolling window whose HV series we percentile-rank the latest reading against.
const PCT_WINDOW = 20;
// ~1 trading year of rolling-HV readings for the percentile baseline.
const PCT_LOOKBACK = 250;
const FETCH_LIMIT = 320;
const VOL_DECIMALS = 2;
const PCT_DECIMALS = 1;

export interface HistoricalVolatility {
	close: number;
	/** Latest candle date. */
	date: string;
	/** Annualized realized volatility % keyed by trading-day window. */
	hv: Record<string, number | null>;
	/** Percentile (0–100) of the latest 20-day HV over ~1 year — high = vol is
	 * historically elevated (options tend rich), low = calm. */
	hv20Percentile: number | null;
	symbol: string;
}

function round(value: number, decimals: number): number {
	const f = 10 ** decimals;
	return Math.round(value * f) / f;
}

export function logReturns(closes: number[]): number[] {
	const out: number[] = [];
	for (let i = 1; i < closes.length; i++) {
		const prev = closes[i - 1];
		const cur = closes[i];
		if (prev !== undefined && cur !== undefined && prev > 0 && cur > 0) {
			out.push(Math.log(cur / prev));
		}
	}
	return out;
}

function stdev(xs: number[]): number {
	if (xs.length < 2) {
		return 0;
	}
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	const variance =
		xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
	return Math.sqrt(variance);
}

// Annualized realized volatility % over a return slice (null if too short).
export function annualizedVolPct(returns: number[]): number | null {
	if (returns.length < 2) {
		return null;
	}
	return round(stdev(returns) * Math.sqrt(TRADING_DAYS) * 100, VOL_DECIMALS);
}

// Percentile rank (0–100) of the latest value within a series.
function percentileOfLast(series: number[]): number | null {
	if (series.length < 2) {
		return null;
	}
	const latest = series.at(-1) as number;
	const below = series.filter((v) => v <= latest).length;
	return round((below / series.length) * 100, PCT_DECIMALS);
}

function rollingHvPercentile(returns: number[]): number | null {
	if (returns.length < PCT_WINDOW + 1) {
		return null;
	}
	const series: number[] = [];
	const start = Math.max(PCT_WINDOW, returns.length - PCT_LOOKBACK);
	for (let end = start; end <= returns.length; end++) {
		const hv = annualizedVolPct(returns.slice(end - PCT_WINDOW, end));
		if (hv !== null) {
			series.push(hv);
		}
	}
	return percentileOfLast(series);
}

// Pure computation over a close/date series, exported for tests.
export function computeVolatility(
	symbol: string,
	closes: number[],
	dates: string[]
): HistoricalVolatility | null {
	if (closes.length < 2) {
		return null;
	}
	const returns = logReturns(closes);
	const hv: Record<string, number | null> = {};
	for (const w of WINDOWS) {
		hv[String(w)] =
			returns.length >= w ? annualizedVolPct(returns.slice(-w)) : null;
	}
	return {
		symbol,
		date: dates.at(-1) ?? "",
		close: closes.at(-1) ?? 0,
		hv,
		hv20Percentile: rollingHvPercentile(returns),
	};
}

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export async function getHistoricalVolatility(
	symbol: string,
	opts: Opts = {}
): Promise<HistoricalVolatility | null> {
	try {
		const candles = await getKline(symbol, "day", FETCH_LIMIT, opts);
		if (candles.length < 2) {
			return null;
		}
		return computeVolatility(
			symbol,
			candles.map((c) => c.close),
			candles.map((c) => c.time)
		);
	} catch {
		return null;
	}
}
