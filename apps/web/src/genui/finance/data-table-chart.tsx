"use client";

import { useEffect, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
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
import type {
	DataTableChartKind,
	DataTableColumn,
	MetricColumn,
} from "./data-table-types";
import { formatCompact } from "./format";

// Phase 1 Task 1 — the Pivot chart view of the `DataTable` primitive (design
// doc §8.1 "趋势图"). The selected metric columns become recharts line/bar
// series over the categoryKey x-axis, inside a `ChartFrame` and themed
// entirely from `chart-theme` (§4, §11 图表 token 单一出口). Multiple selected
// metrics overlay as a Compare view; each series' color is supplied by the
// orchestrator so it stays stable across selection and matches its chip tone.

const LINE_STROKE_WIDTH = 2;
const CHART_ACCESSIBLE_LABEL = "趋势图";
const CHART_MARGIN = { top: 8, right: 16, bottom: 0, left: 0 } as const;
const CATEGORY_FIELD = "__category";

interface ChartSeries {
	color: string;
	key: string;
	label: string;
}

const NUMERIC_ORDER_KEY_RE = /^-?\d+(\.\d+)?$/;

/** Parses a categoryKey's raw string into an ascending sort key, or `null`
 * when it isn't date/number-orderable (e.g. a holder/institution name). Plain
 * numeric strings — including bare years like "2023" — sort by their numeric
 * value; everything else falls through to `Date.parse` so ISO date strings
 * ("2023-12-31") order chronologically too. */
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

/** Rows in ascending categoryKey order, so the chart's x-axis always reads
 * left→right chronologically — regardless of whether the source payload is
 * newest-first (statements/indicators/dividends), oldest-first
 * (earnings_forecast), or not date/number-orderable at all (top_holders'
 * institution name), in which case we fall back to the given row order
 * rather than guessing. For a newest-first date payload this produces the
 * same order the old blind `.reverse()` did — a no-behavior-change swap. */
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

/** Recharts needs a flat row keyed by field name; we project each source row
 * to a stringified category label plus one numeric field per selected
 * metric, in ascending categoryKey order (see `orderedForChart`) so time
 * reads left→right regardless of the source payload's own ordering. */
function toChartData<T>(
	rows: T[],
	categoryKey: string,
	metrics: DataTableColumn<T>[]
): Record<string, number | string | null>[] {
	return orderedForChart(rows, categoryKey).map((row) => {
		const point: Record<string, number | string | null> = {
			[CATEGORY_FIELD]: String(
				(row as Record<string, unknown>)[categoryKey] ?? ""
			),
		};
		for (const metric of metrics) {
			point[metric.key] = metric.value?.(row) ?? null;
		}
		return point;
	});
}

function SeriesMarks({
	isAnimationActive,
	kind,
	series,
}: {
	isAnimationActive: boolean;
	kind: DataTableChartKind;
	series: ChartSeries[];
}) {
	if (kind === "bar") {
		return (
			<>
				{series.map((s) => (
					<Bar
						dataKey={s.key}
						fill={s.color}
						isAnimationActive={isAnimationActive}
						key={s.key}
						name={s.label}
					/>
				))}
			</>
		);
	}
	return (
		<>
			{series.map((s) => (
				<Line
					dataKey={s.key}
					dot={false}
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

function ChartInner({
	categoryFormat,
	data,
	isAnimationActive,
	kind,
	series,
}: {
	categoryFormat?: (raw: string) => string;
	data: Record<string, number | string | null>[];
	isAnimationActive: boolean;
	kind: DataTableChartKind;
	series: ChartSeries[];
}) {
	const ChartRoot = kind === "bar" ? BarChart : LineChart;
	const formatCategory = (raw: string) => categoryFormat?.(raw) ?? raw;
	return (
		<ResponsiveContainer height={DEFAULT_CHART_HEIGHT} width="100%">
			<ChartRoot data={data} margin={CHART_MARGIN}>
				<CartesianGrid {...rechartsGridProps} />
				<XAxis
					dataKey={CATEGORY_FIELD}
					tickFormatter={formatCategory}
					{...rechartsAxisTheme}
				/>
				<YAxis
					{...rechartsAxisTheme}
					tickFormatter={(value: number) => formatCompact(value)}
					width={undefined}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					cursor={rechartsCursorProps}
					formatter={(value) => formatCompact(Number(value))}
					labelFormatter={formatCategory}
				/>
				<SeriesMarks
					isAnimationActive={isAnimationActive}
					kind={kind}
					series={series}
				/>
			</ChartRoot>
		</ResponsiveContainer>
	);
}

/** Guardrail 1 (§6): the draw-in animation must fire only when the chart
 * view is (re-)entered — first mount or a Pivot toggle back into chart —
 * never on a data re-slice (filter/period/series change) while already in
 * chart view. `ViewSwitch` keys its wrapper by Pivot `view`, so this
 * component remounts (and `hasAnimated` resets to false) on every chart-view
 * entry; a data-only re-render leaves the existing mount — and `hasAnimated`
 * — untouched, so recharts is told to skip the replay. */
function useHasAnimated(): boolean {
	const [hasAnimated, setHasAnimated] = useState(false);
	useEffect(() => {
		setHasAnimated(true);
	}, []);
	return hasAnimated;
}

export interface DataTableChartProps<T> {
	categoryFormat?: (raw: string) => string;
	categoryKey: string;
	chartKind: DataTableChartKind;
	metrics: MetricColumn<T>[];
	reduced: boolean;
	rows: T[];
}

export function DataTableChart<T>({
	categoryFormat,
	categoryKey,
	chartKind,
	metrics,
	reduced,
	rows,
}: DataTableChartProps<T>) {
	const hasAnimated = useHasAnimated();
	const isAnimationActive = !(hasAnimated || reduced);
	const series: ChartSeries[] = metrics.map((m) => ({
		color: m.color,
		key: m.key,
		label: m.label,
	}));
	const data = toChartData(rows, categoryKey, metrics);
	const empty = data.length === 0 || series.length === 0;
	return (
		<div aria-label={CHART_ACCESSIBLE_LABEL} role="img">
			<ChartFrame empty={empty}>
				<ChartInner
					categoryFormat={categoryFormat}
					data={data}
					isAnimationActive={isAnimationActive}
					kind={chartKind}
					series={series}
				/>
			</ChartFrame>
		</div>
	);
}
