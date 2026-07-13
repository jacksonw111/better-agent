import { compositionHueRamp } from "./chart-theme";
import type { CandleData } from "./finance-schemas";

// Phase 2 Task 5 — pure MA (simple moving average) math for the PriceChart
// archetype's Se (Series) overlay toggles (design doc §8.4 "Se MA 叠加开关").
// Kept separate from candlestick-canvas.tsx (which owns the lightweight-
// charts lifecycle) so the highest-value thing to unit test here — the MA
// math — carries zero chart-library or React import weight.

const MA_PERIOD_SHORT = 5;
const MA_PERIOD_MEDIUM = 10;
const MA_PERIOD_LONG = 20;

export interface MaConfig {
	id: string;
	label: string;
	period: number;
}

/** MA5/MA10/MA20 — the three overlays finance_kline offers. Order also
 * drives the `MA_COLORS` ramp assignment below (deepest → lightest). */
export const MA_CONFIGS: MaConfig[] = [
	{ id: "ma5", label: "MA5", period: MA_PERIOD_SHORT },
	{ id: "ma10", label: "MA10", period: MA_PERIOD_MEDIUM },
	{ id: "ma20", label: "MA20", period: MA_PERIOD_LONG },
];

/** One color per `MA_CONFIGS` entry, from the shared composition-hue ramp
 * (§11 图表 token 单一出口 — no hardcoded hex here). Computed once at module
 * load since `MA_CONFIGS.length` is fixed, so both the Chip tones
 * (candlestick-controls.tsx) and the line series (candlestick-canvas.tsx)
 * reference the exact same array by identity. */
export const MA_COLORS: string[] = compositionHueRamp(MA_CONFIGS.length);

export interface MaPoint {
	time: string;
	value: number;
}

/** Simple moving average of `close` over a trailing window of `period`
 * candles. Points before the window fills are omitted (a shorter line than
 * the candle series is the standard SMA warm-up convention) rather than
 * emitting a misleading partial-window average. `period <= 0` → []. */
export function computeMA(candles: CandleData[], period: number): MaPoint[] {
	if (period <= 0) {
		return [];
	}
	const points: MaPoint[] = [];
	let windowSum = 0;
	for (let index = 0; index < candles.length; index++) {
		const candle = candles[index] as CandleData;
		windowSum += candle.close;
		const outgoing = candles[index - period];
		if (outgoing) {
			windowSum -= outgoing.close;
		}
		if (index >= period - 1) {
			points.push({ time: candle.time, value: windowSum / period });
		}
	}
	return points;
}
