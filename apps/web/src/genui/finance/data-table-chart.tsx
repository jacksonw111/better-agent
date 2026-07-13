"use client";

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
	rechartsAxisTheme,
	rechartsCursorProps,
	rechartsGridProps,
	TOOLTIP_STYLE,
} from "./chart-theme";
import type { DataTableChartKind, DataTableColumn } from "./data-table-types";
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

/** Recharts needs a flat row keyed by field name; we project each source row
 * to a stringified category label plus one numeric field per selected metric,
 * reversed so time reads left→right (payloads arrive newest-first). */
function toChartData<T>(
	rows: T[],
	categoryKey: string,
	metrics: DataTableColumn<T>[]
): Record<string, number | string | null>[] {
	return [...rows].reverse().map((row) => {
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
	kind,
	series,
}: {
	kind: DataTableChartKind;
	series: ChartSeries[];
}) {
	if (kind === "bar") {
		return (
			<>
				{series.map((s) => (
					<Bar dataKey={s.key} fill={s.color} key={s.key} name={s.label} />
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
	data,
	kind,
	series,
}: {
	data: Record<string, number | string | null>[];
	kind: DataTableChartKind;
	series: ChartSeries[];
}) {
	const ChartRoot = kind === "bar" ? BarChart : LineChart;
	return (
		<ResponsiveContainer height="100%" width="100%">
			<ChartRoot data={data} margin={CHART_MARGIN}>
				<CartesianGrid {...rechartsGridProps} />
				<XAxis dataKey={CATEGORY_FIELD} {...rechartsAxisTheme} />
				<YAxis
					{...rechartsAxisTheme}
					tickFormatter={(value: number) => formatCompact(value)}
					width={undefined}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					cursor={rechartsCursorProps}
					formatter={(value) => formatCompact(Number(value))}
				/>
				<SeriesMarks kind={kind} series={series} />
			</ChartRoot>
		</ResponsiveContainer>
	);
}

export function DataTableChart<T>({
	categoryKey,
	chartKind,
	metrics,
	rows,
}: {
	categoryKey: string;
	chartKind: DataTableChartKind;
	metrics: (DataTableColumn<T> & { color: string })[];
	rows: T[];
}) {
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
				<ChartInner data={data} kind={chartKind} series={series} />
			</ChartFrame>
		</div>
	);
}
