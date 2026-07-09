"use client";

import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { HolderCountRowData } from "./finance-schemas-fe12";
import { formatCompact, formatDate } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const CHART_HEIGHT = 200;
const TICK_FONT_SIZE = 11;
const LINE_STROKE_WIDTH = 2;
const DOT_RADIUS = 3;
// Neutral indigo — 股东户数 is a headcount level, not a signed price change, so
// 红涨绿跌 doesn't apply (same reasoning as margin-chart.tsx).
const LINE_COLOR = "#6366f1";
const GRID_COLOR = "var(--border)";
const AXIS_LABEL_LENGTH = 5; // "MM-DD" tail of the formatted date

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

interface ChartRow {
	date: string;
	totalHolders: number;
}

function formatAxisTick(date: string): string {
	return formatDate(date).slice(-AXIS_LABEL_LENGTH);
}

function toChartRow(row: HolderCountRowData): ChartRow | null {
	if (row.totalHolders === null) {
		return null;
	}
	return { date: row.endDate, totalHolders: row.totalHolders };
}

function isChartRow(row: ChartRow | null): row is ChartRow {
	return row !== null;
}

function HolderCountLine({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
				<CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
				<XAxis
					dataKey="date"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={formatAxisTick}
				/>
				<YAxis
					domain={["auto", "auto"]}
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={(value: number) => formatCompact(value)}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					formatter={(value) => [formatCompact(Number(value)), "股东户数"]}
					labelFormatter={(label: string) => formatDate(label)}
				/>
				<Line
					dataKey="totalHolders"
					dot={{ fill: LINE_COLOR, r: DOT_RADIUS }}
					stroke={LINE_COLOR}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}

const HOLDER_COUNT_COLUMNS: FinTableColumn<HolderCountRowData>[] = [
	{
		key: "endDate",
		label: "报告期",
		render: (row) => formatDate(row.endDate),
	},
	{
		align: "right",
		key: "totalHolders",
		label: "户数",
		render: (row) => formatCompact(row.totalHolders),
	},
	{
		align: "right",
		key: "changeRatio",
		label: "较上期",
		render: (row) => <ChangePct value={row.changeRatio} />,
	},
	{
		align: "right",
		key: "avgFreeShares",
		label: "户均流通股",
		render: (row) => formatCompact(row.avgFreeShares),
	},
];

/** finance_holder_count → 股东户数, newest `endDate` first (the tool already
 * returns rows in that order). Renders a line chart of total holder count
 * over time — reversed to chronological order for the x-axis — plus a
 * compact table of the same rows in source (newest-first) order. A falling
 * holder count usually signals chip concentration (筹码集中), generally read
 * as bullish, hence the hint below the chart. */
export function HolderCountChart({ data }: { data: HolderCountRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const chartData = [...data].reverse().map(toChartRow).filter(isChartRow);
	return (
		<CardShell title="股东户数">
			{chartData.length > 0 ? <HolderCountLine data={chartData} /> : null}
			<p className="text-muted-foreground text-xs">
				户数下降通常意味着筹码集中，一般视为利好信号
			</p>
			<FinTable
				columns={HOLDER_COUNT_COLUMNS}
				getRowKey={(row, index) => `${row.endDate}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
