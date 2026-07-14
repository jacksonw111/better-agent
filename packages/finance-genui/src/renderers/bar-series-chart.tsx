"use client";

import { useEffect, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { BarSeriesColoring, ResolvedSeries } from "./bar-series-types";
import { ChartFrame } from "./chart-frame";
import {
	AXIS_TEXT_COLOR,
	changeColor,
	DEFAULT_CHART_HEIGHT,
	RECHARTS_XAXIS_HEIGHT,
	RECHARTS_YAXIS_WIDTH,
	rechartsAxisTheme,
	rechartsCursorProps,
	rechartsGridProps,
	TOOLTIP_STYLE,
} from "./chart-theme";
import { formatCompact } from "./format";
import { DRAW_IN_MS } from "./motion";

// Phase 2 Task 1 — the recharts grouped-bar chart of the `BarSeries`
// archetype (design doc §8.2). Themed entirely from `chart-theme` (§4, §11
// 图表 token 单一出口). Lazily imported by bar-series-view.tsx so recharts
// never ships in the eager chat bundle.

const CHART_ACCESSIBLE_LABEL = "分组柱状图";
const CHART_MARGIN = { top: 8, right: 16, bottom: 0, left: 0 } as const;
const CATEGORY_FIELD = "__category";
const ZERO_BASELINE = 0;
const CHART_EASING = "ease-out";

const NUMERIC_ORDER_KEY_RE = /^-?\d+(\.\d+)?$/;

/** Parses a categoryKey's raw string into an ascending sort key, or `null`
 * when it isn't date/number-orderable — same convention as
 * data-table-chart.tsx's `parseOrderKey`. */
function parseOrderKey(raw: string): number | null {
	const trimmed = raw.trim();
	if (trimmed === "") {
		return null;
	}
	if (NUMERIC_ORDER_KEY_RE.test(trimmed)) {
		return Number(trimmed);
	}
	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? null : parsed;
}

/** Rows in ascending categoryKey order, so the x-axis always reads
 * left→right chronologically regardless of the source payload's own order
 * (money_flow/hsgt_flow/margin all return newest-first). Falls back to the
 * given row order when the key isn't fully orderable. */
function orderedForChart<T>(rows: T[], categoryKey: string): T[] {
	const keyed = rows.map((row) => ({
		key: parseOrderKey(
			String((row as Record<string, unknown>)[categoryKey] ?? "")
		),
		row,
	}));
	const isFullyOrderable = keyed.every((entry) => entry.key !== null);
	if (!isFullyOrderable) {
		return rows;
	}
	return keyed
		.slice()
		.sort((a, b) => (a.key as number) - (b.key as number))
		.map((entry) => entry.row);
}

function toChartData<T>(
	rows: T[],
	categoryKey: string,
	series: ResolvedSeries<T>[]
): Record<string, number | string | null>[] {
	return orderedForChart(rows, categoryKey).map((row) => {
		const point: Record<string, number | string | null> = {
			[CATEGORY_FIELD]: String(
				(row as Record<string, unknown>)[categoryKey] ?? ""
			),
		};
		for (const s of series) {
			point[s.key] = s.value(row);
		}
		return point;
	});
}

/** §5.3: when "composition" coloring is narrowed by the Filter chips down to
 * a single visible bucket, direction is no longer ambiguous — switch that
 * lone series to sign color. This is the fix for money_flow's "四档全红"
 * bug: the default multi-bucket view stays hue-per-bucket (distinguishable),
 * and isolating one bucket recovers the useful red/green direction read. */
function effectiveColoring(
	coloring: BarSeriesColoring,
	visibleSeriesCount: number
): BarSeriesColoring {
	if (coloring === "composition" && visibleSeriesCount === 1) {
		return "sign";
	}
	return coloring;
}

/** Sign mode: each bar's fill varies per data point (red/green by that
 * point's own sign), so it needs a `<Cell>` per point rather than one flat
 * `fill` on the `<Bar>` — same technique the old money-flow-chart used. */
// These return raw ARRAYS of <Bar> (called inline, not rendered as
// <SeriesBars/>), so the <Bar> elements are DIRECT children of <BarChart>.
// recharts only discovers series among its direct children's types — a custom
// component (or even a Fragment) wrapping them is invisible to it, so the
// chart ends up with no series and renders a blank plot. `<Cell>` children of
// a `<Bar>` are fine (recharts reads a Bar's own children for per-point fill).

/** Sign mode: each bar's fill varies per data point (red/green by that
 * point's own sign), so it needs a `<Cell>` per point rather than one flat
 * `fill` on the `<Bar>` — same technique the old money-flow-chart used. */
function signBars<T>({
	data,
	isAnimationActive,
	series,
}: {
	data: Record<string, number | string | null>[];
	isAnimationActive: boolean;
	series: ResolvedSeries<T>[];
}) {
	return series.map((s) => (
		<Bar
			animationDuration={DRAW_IN_MS}
			animationEasing={CHART_EASING}
			dataKey={s.key}
			isAnimationActive={isAnimationActive}
			key={s.key}
			name={s.label}
		>
			{data.map((point) => (
				<Cell
					fill={changeColor(point[s.key] as number | null) ?? AXIS_TEXT_COLOR}
					key={`${s.key}-${point[CATEGORY_FIELD]}`}
				/>
			))}
		</Bar>
	));
}

/** Composition mode: each series gets one flat, stable hue (its
 * compositionHueRamp color) regardless of a data point's sign. */
function compositionBars<T>({
	isAnimationActive,
	series,
}: {
	isAnimationActive: boolean;
	series: ResolvedSeries<T>[];
}) {
	return series.map((s) => (
		<Bar
			animationDuration={DRAW_IN_MS}
			animationEasing={CHART_EASING}
			dataKey={s.key}
			fill={s.color}
			isAnimationActive={isAnimationActive}
			key={s.key}
			name={s.label}
		/>
	));
}

function seriesBars<T>({
	data,
	isAnimationActive,
	mode,
	series,
}: {
	data: Record<string, number | string | null>[];
	isAnimationActive: boolean;
	mode: BarSeriesColoring;
	series: ResolvedSeries<T>[];
}) {
	if (mode === "sign") {
		return signBars({ data, isAnimationActive, series });
	}
	return compositionBars({ isAnimationActive, series });
}

function ChartInner<T>({
	categoryFormat,
	data,
	isAnimationActive,
	mode,
	series,
}: {
	categoryFormat?: (raw: string) => string;
	data: Record<string, number | string | null>[];
	isAnimationActive: boolean;
	mode: BarSeriesColoring;
	series: ResolvedSeries<T>[];
}) {
	const formatCategory = (raw: string) => categoryFormat?.(raw) ?? raw;
	return (
		<ResponsiveContainer height={DEFAULT_CHART_HEIGHT} width="100%">
			<BarChart data={data} margin={CHART_MARGIN}>
				<CartesianGrid {...rechartsGridProps} />
				<XAxis
					dataKey={CATEGORY_FIELD}
					height={RECHARTS_XAXIS_HEIGHT}
					tickFormatter={formatCategory}
					{...rechartsAxisTheme}
				/>
				<YAxis
					{...rechartsAxisTheme}
					tickFormatter={(value: number) => formatCompact(value)}
					width={RECHARTS_YAXIS_WIDTH}
				/>
				{/* §5.3: the zero axis is what expresses sign in composition mode,
				 * so it must read clearly regardless of the plot's own domain. */}
				<ReferenceLine stroke={rechartsAxisTheme.stroke} y={ZERO_BASELINE} />
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					cursor={rechartsCursorProps}
					formatter={(value, name) => [formatCompact(Number(value)), name]}
					labelFormatter={formatCategory}
				/>
				{seriesBars({ data, isAnimationActive, mode, series })}
			</BarChart>
		</ResponsiveContainer>
	);
}

/** Guardrail 1 (§6): draw-in fires only on chart-view (re-)entry — first
 * mount or a Pivot toggle back into chart — never on a data re-slice
 * (Filter/Period change) while already in chart view. bar-series-view.tsx
 * keys its wrapper by Pivot `view`, so this component remounts (and
 * `hasAnimated` resets) on every chart-view entry; a data-only re-render
 * leaves the mount — and `hasAnimated` — untouched. */
function useHasAnimated(): boolean {
	const [hasAnimated, setHasAnimated] = useState(false);
	useEffect(() => {
		setHasAnimated(true);
	}, []);
	return hasAnimated;
}

export interface BarSeriesChartProps<T> {
	categoryFormat?: (raw: string) => string;
	categoryKey: string;
	coloring: BarSeriesColoring;
	reduced: boolean;
	rows: T[];
	/** Already narrowed to the currently-visible (Filter-selected) buckets,
	 * each carrying its stable composition-ramp color. */
	series: ResolvedSeries<T>[];
}

export function BarSeriesChart<T>({
	categoryFormat,
	categoryKey,
	coloring,
	reduced,
	rows,
	series,
}: BarSeriesChartProps<T>) {
	const hasAnimated = useHasAnimated();
	const isAnimationActive = !(hasAnimated || reduced);
	const data = toChartData(rows, categoryKey, series);
	const mode = effectiveColoring(coloring, series.length);
	const empty = data.length === 0 || series.length === 0;
	return (
		<div aria-label={CHART_ACCESSIBLE_LABEL} role="img">
			<ChartFrame empty={empty}>
				<ChartInner
					categoryFormat={categoryFormat}
					data={data}
					isAnimationActive={isAnimationActive}
					mode={mode}
					series={series}
				/>
			</ChartFrame>
		</div>
	);
}
