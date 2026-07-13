"use client";

import { ChartCanvas } from "./candlestick-canvas";
import {
	CandlestickStrip,
	RANGE_OPTIONS,
	rangeCandleCount,
	rangeDisabledIds,
} from "./candlestick-controls";
import { MA_CONFIGS } from "./candlestick-ma";
import { ChartFrame } from "./chart-frame";
import type { CandleData } from "./finance-schemas";
import { CardShell } from "./primitives";
import { usePeriod } from "./use-period";
import { useSeriesSelect } from "./use-series-select";

// Phase 2 Task 5 — finance_kline on the PriceChart archetype (design doc
// §8.4: PriceChart · I·P·Se), the flagship "一目了然" chart. lightweight-
// charts (lazily loaded via chart-module.ts) owns OHLC + volume + the native
// crosshair (candlestick-canvas.tsx); this file wires the CardShell/
// ControlStrip contract and the two client-side verbs — P (visible range)
// via usePeriod, Se (MA overlays) via useSeriesSelect with a 0 floor, since
// MA lines are optional (unlike every other Series chip group, which
// enforces a min-1 floor so a chart never goes empty).
const MA_MIN_SELECTED = 0;

const RANGE_IDS = RANGE_OPTIONS.map((option) => option.id);
const MA_IDS = MA_CONFIGS.map((ma) => ma.id);
// "全部" — matches the prior unconditional fitContent()-on-mount behavior;
// narrower ranges are opt-in via the Segmented control.
const DEFAULT_RANGE_ID = RANGE_OPTIONS.at(-1)?.id ?? "all";

/** "N 根 · first ~ last" (or just one date when there's only one candle) —
 * makes the chart visibly a series even at a glance, before the async chart
 * itself has finished mounting. */
function formatCandleRange(candles: CandleData[]): string {
	const first = candles[0]?.time ?? "";
	const last = candles.at(-1)?.time ?? "";
	const range = first === last ? first : `${first} ~ ${last}`;
	return `${candles.length} 根 · ${range}`;
}

/** finance_kline → a candlestick + volume chart on the shared chart-theme
 * skin. Candles come from the tool result (a prop), not a fetch — the range
 * (P) and MA (Se) controls only re-view what's already there, never
 * triggering a new tool call (§11 交互只在 payload 内). */
export function CandlestickChart({ candles }: { candles: CandleData[] }) {
	const isEmpty = candles.length === 0;
	const range = usePeriod(RANGE_IDS, { initial: DEFAULT_RANGE_ID });
	const maSelect = useSeriesSelect(MA_IDS, {
		initial: MA_IDS,
		min: MA_MIN_SELECTED,
	});

	return (
		<CardShell
			subtitle={isEmpty ? undefined : formatCandleRange(candles)}
			title="K线"
		>
			{isEmpty ? null : (
				<CandlestickStrip
					disabledRangeIds={rangeDisabledIds(candles.length)}
					maSelect={maSelect}
					range={range}
				/>
			)}
			<ChartFrame empty={isEmpty} emptyLabel="暂无 K线数据">
				{isEmpty ? null : (
					<ChartCanvas
						candles={candles}
						maSelected={maSelect.selected}
						rangeN={rangeCandleCount(range.period)}
					/>
				)}
			</ChartFrame>
		</CardShell>
	);
}
