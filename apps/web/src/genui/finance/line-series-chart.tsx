"use client";

import { useEffect, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ChartFrame } from "./chart-frame";
import {
	DEFAULT_CHART_HEIGHT,
	rechartsAxisTheme,
	rechartsCursorProps,
	rechartsGridProps,
	TOOLTIP_STYLE,
} from "./chart-theme";
import type { ResolvedLineSeries } from "./line-series-types";
import { DRAW_IN_MS } from "./motion";

// Phase 2 Task 3 — the recharts line/area chart of the `LineSeries`
// archetype (design doc §8.3). Themed entirely from `chart-theme` (§4, §11
// 图表 token 单一出口). Lazily imported by line-series-view.tsx so recharts
// never ships in the eager chat bundle. A single `<AreaChart>` renders every
// series as an `<Area>` regardless of the `area` prop — toggling `area` only
// switches the fill's opacity, so overlaying 1-N series never needs to swap
// chart component types.

const CHART_ACCESSIBLE_LABEL = "折线图";
const CHART_MARGIN = { top: 8, right: 16, bottom: 0, left: 0 } as const;
const CATEGORY_FIELD = "__category";
const CHART_EASING = "ease-out";
const LINE_STROKE_WIDTH = 2;
const DOT_RADIUS = 3;
const AREA_FILL_OPACITY = 0.15;
const LINE_FILL_OPACITY = 0;

const NUMERIC_ORDER_KEY_RE = /^-?\d+(\.\d+)?$/;

/** Parses a categoryKey's raw string into an ascending sort key, or `null`
 * when it isn't date/number-orderable — same convention as
 * bar-series-chart.tsx's `parseOrderKey`. */
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
 * (holder_count/margin both return newest-first). Falls back to the given
 * row order when the key isn't fully orderable. */
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
	series: ResolvedLineSeries<T>[]
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

function SeriesAreas<T>({
	area,
	isAnimationActive,
	series,
}: {
	area: boolean;
	isAnimationActive: boolean;
	series: ResolvedLineSeries<T>[];
}) {
	return (
		<>
			{series.map((s) => (
				<Area
					animationDuration={DRAW_IN_MS}
					animationEasing={CHART_EASING}
					connectNulls
					dataKey={s.key}
					dot={{ fill: s.color, r: DOT_RADIUS }}
					fill={s.color}
					fillOpacity={area ? AREA_FILL_OPACITY : LINE_FILL_OPACITY}
					isAnimationActive={isAnimationActive}
					key={s.key}
					name={s.label}
					stroke={s.color}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
			))}
		</>
	);
}

function ChartInner<T>({
	area,
	categoryFormat,
	data,
	isAnimationActive,
	series,
	valueFormat,
}: {
	area: boolean;
	categoryFormat?: (raw: string) => string;
	data: Record<string, number | string | null>[];
	isAnimationActive: boolean;
	series: ResolvedLineSeries<T>[];
	valueFormat: (value: number) => string;
}) {
	const formatCategory = (raw: string) => categoryFormat?.(raw) ?? raw;
	return (
		<ResponsiveContainer height={DEFAULT_CHART_HEIGHT} width="100%">
			<AreaChart data={data} margin={CHART_MARGIN}>
				<CartesianGrid {...rechartsGridProps} />
				<XAxis
					dataKey={CATEGORY_FIELD}
					tickFormatter={formatCategory}
					{...rechartsAxisTheme}
				/>
				<YAxis
					{...rechartsAxisTheme}
					tickFormatter={(value: number) => valueFormat(value)}
					width={undefined}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					cursor={rechartsCursorProps}
					formatter={(value, name) => [valueFormat(Number(value)), name]}
					labelFormatter={formatCategory}
				/>
				<SeriesAreas
					area={area}
					isAnimationActive={isAnimationActive}
					series={series}
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}

/** Guardrail 1 (§6): draw-in fires only on chart-view (re-)entry — first
 * mount or a Pivot toggle back into chart — never on a data re-slice
 * (Series/Period change) while already in chart view. line-series-view.tsx
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

export interface LineSeriesChartProps<T> {
	area: boolean;
	categoryFormat?: (raw: string) => string;
	categoryKey: string;
	reduced: boolean;
	rows: T[];
	/** Already narrowed to the currently-visible (Series/Compare-selected)
	 * lines, each carrying its stable composition-ramp color. */
	series: ResolvedLineSeries<T>[];
	valueFormat: (value: number) => string;
}

export function LineSeriesChart<T>({
	area,
	categoryFormat,
	categoryKey,
	reduced,
	rows,
	series,
	valueFormat,
}: LineSeriesChartProps<T>) {
	const hasAnimated = useHasAnimated();
	const isAnimationActive = !(hasAnimated || reduced);
	const data = toChartData(rows, categoryKey, series);
	const empty = data.length === 0 || series.length === 0;
	return (
		<div aria-label={CHART_ACCESSIBLE_LABEL} role="img">
			<ChartFrame empty={empty}>
				<ChartInner
					area={area}
					categoryFormat={categoryFormat}
					data={data}
					isAnimationActive={isAnimationActive}
					series={series}
					valueFormat={valueFormat}
				/>
			</ChartFrame>
		</div>
	);
}
