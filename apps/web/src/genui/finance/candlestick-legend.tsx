import { DOWN_COLOR, UP_COLOR } from "./chart-theme";
import { formatNum } from "./format";

// Phase 2 Task 5 — the PriceChart hover readout (design doc §8.4 "I
// crosshair hover 显价 + 底部显时间"). lightweight-charts' native crosshair
// already puts price on the right scale and time on the bottom scale; this
// small overlay adds the O/H/L/C reading the two axes alone can't show at a
// glance, bridged from `chart.subscribeCrosshairMove` in candlestick-canvas.tsx.

export interface CandleHoverInfo {
	close: number;
	high: number;
	low: number;
	open: number;
	time: string;
}

/** Top-left OHLC overlay, colored by the price axis (red up / green down —
 * §5.2, never a hardcoded literal). Renders nothing when there's no active
 * hover (pointer left the chart, or it hasn't been touched yet). Zero
 * border/ring — a tinted, rounded surface only (§5.1). */
export function CandlestickLegend({ info }: { info: CandleHoverInfo | null }) {
	if (!info) {
		return null;
	}
	const color = info.close >= info.open ? UP_COLOR : DOWN_COLOR;
	return (
		<div className="pointer-events-none absolute top-1 left-1 z-10 flex flex-wrap items-baseline gap-x-2 rounded-md bg-background/70 px-2 py-1 text-xs tabular-nums">
			<span className="text-muted-foreground">{info.time}</span>
			<span style={{ color }}>开 {formatNum(info.open)}</span>
			<span style={{ color }}>高 {formatNum(info.high)}</span>
			<span style={{ color }}>低 {formatNum(info.low)}</span>
			<span style={{ color }}>收 {formatNum(info.close)}</span>
		</div>
	);
}
