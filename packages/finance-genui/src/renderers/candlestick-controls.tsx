import { MA_COLORS, MA_CONFIGS } from "./candlestick-ma";
import { Chip } from "./chip";
import { ControlStrip } from "./control-strip";
import { Segmented } from "./segmented";
import type { usePeriod } from "./use-period";
import type { useSeriesSelect } from "./use-series-select";

// Phase 2 Task 5 — PriceChart's ControlStrip contents (design doc §3, §8.4):
// left = range Segmented (P — the visible window within the already-
// returned candles, never a re-fetch), right = MA Chips (Se — zero-or-more,
// no min floor since MA overlays are optional, unlike every other Series
// chip group which enforces min-1). Split out of candlestick-chart.tsx to
// respect the file/function size caps.

export interface RangeOption {
	id: string;
	label: string;
	/** Trailing candle count this range shows, or `null` for "全部" (no
	 * limit — always available regardless of payload size). */
	n: number | null;
}

const RANGE_RECENT_30 = 30;
const RANGE_RECENT_60 = 60;

export const RANGE_OPTIONS: RangeOption[] = [
	{ id: "recent30", label: "近30", n: RANGE_RECENT_30 },
	{ id: "recent60", label: "近60", n: RANGE_RECENT_60 },
	{ id: "all", label: "全部", n: null },
];

/** The trailing candle count for a selected range id, or `null` for "全部" /
 * an unknown id (both mean "no limit"). */
export function rangeCandleCount(rangeId: string): number | null {
	return RANGE_OPTIONS.find((option) => option.id === rangeId)?.n ?? null;
}

/** Ranges whose trailing window exceeds the payload's candle count — greyed
 * out per §3 "超出 payload 置灰" rather than omitted, so the control's shape
 * stays stable across payload sizes. "全部" is always available. */
export function rangeDisabledIds(candleCount: number): string[] {
	return RANGE_OPTIONS.filter(
		(option) => option.n !== null && option.n > candleCount
	).map((option) => option.id);
}

function MaChips({
	maSelect,
}: {
	maSelect: ReturnType<typeof useSeriesSelect>;
}) {
	return (
		<>
			{MA_CONFIGS.map((ma, index) => (
				<Chip
					active={maSelect.isSelected(ma.id)}
					key={ma.id}
					label={ma.label}
					onToggle={() => maSelect.toggle(ma.id)}
					tone={MA_COLORS[index]}
				/>
			))}
		</>
	);
}

export interface CandlestickStripProps {
	disabledRangeIds: string[];
	maSelect: ReturnType<typeof useSeriesSelect>;
	range: ReturnType<typeof usePeriod<string>>;
}

/** The PriceChart ControlStrip: left = range Segmented, right = MA Chips. */
export function CandlestickStrip({
	disabledRangeIds,
	maSelect,
	range,
}: CandlestickStripProps) {
	return (
		<ControlStrip
			chips={<MaChips maSelect={maSelect} />}
			primary={
				<Segmented
					disabledIds={disabledRangeIds}
					onChange={range.setPeriod}
					options={RANGE_OPTIONS.map((option) => ({
						id: option.id,
						label: option.label,
					}))}
					value={range.period}
				/>
			}
		/>
	);
}
