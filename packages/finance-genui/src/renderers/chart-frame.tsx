import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { DEFAULT_CHART_HEIGHT } from "./chart-theme";

// The presentational region every chart (lightweight-charts or recharts)
// renders inside, so PriceChart/BarSeries/LineSeries share one frame instead
// of each inventing its own empty/loading placeholder (§4, Phase 0 primitive
// kit: "ChartFrame + chart-theme"). This is the chart REGION wrapper — it
// lives inside a CardShell body (or standalone), and never duplicates
// CardShell's header/tint chrome.

const DEFAULT_EMPTY_LABEL = "暂无数据";
const LOADING_LABEL = "加载中…";

/** Empty/loading placeholder: centered muted text over a tinted, bordered-
 * free box (§5.1 零边框零 ring — depth is tint + `rounded-md` only). */
function ChartPlaceholder({
	height,
	label,
	pulsing,
}: {
	height: number;
	label: string;
	pulsing?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex items-center justify-center rounded-md bg-muted/30 text-muted-foreground text-sm",
				pulsing && "animate-pulse"
			)}
			style={{ height }}
		>
			{label}
		</div>
	);
}

export interface ChartFrameProps {
	children: ReactNode;
	empty?: boolean;
	/** Shown when `empty` is true. Defaults to "暂无数据". */
	emptyLabel?: string;
	/** Fixed region height in px. Defaults to `DEFAULT_CHART_HEIGHT` from
	 * chart-theme so every chart that doesn't need a custom height shares one
	 * value. */
	height?: number;
	loading?: boolean;
}

/** Fixed-height chart region: renders a loading placeholder, an empty
 * placeholder, or `children` (the actual chart canvas/SVG) — always at the
 * same height, so a card never jumps as data resolves. Zero border / zero
 * ring anywhere (§5.1, §11). */
export function ChartFrame({
	height = DEFAULT_CHART_HEIGHT,
	loading = false,
	empty = false,
	emptyLabel = DEFAULT_EMPTY_LABEL,
	children,
}: ChartFrameProps) {
	if (loading) {
		return <ChartPlaceholder height={height} label={LOADING_LABEL} pulsing />;
	}
	if (empty) {
		return <ChartPlaceholder height={height} label={emptyLabel} />;
	}
	return (
		<div className="rounded-md" style={{ height }}>
			{children}
		</div>
	);
}
