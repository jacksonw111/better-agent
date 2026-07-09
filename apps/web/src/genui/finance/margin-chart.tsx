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
import type { MarginRowData } from "./finance-schemas-fe11";
import { formatCompact, formatDate, formatRatio } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const CHART_HEIGHT = 220;
const TICK_FONT_SIZE = 11;
const LINE_STROKE_WIDTH = 2;
const DOT_RADIUS = 3;
// Neutral amber — 融资余额 is a balance level, not a signed change series, so
// 红涨绿跌 doesn't apply here (same reasoning as yield-curve-chart.tsx).
const LINE_COLOR = "#f59e0b";
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
	financingBalance: number;
}

function formatAxisTick(date: string): string {
	return formatDate(date).slice(-AXIS_LABEL_LENGTH);
}

function MarginBalanceLine({ data }: { data: ChartRow[] }) {
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
					formatter={(value) => [
						formatCompact(Number(value), { cny: true }),
						"融资余额",
					]}
					labelFormatter={(label: string) => formatDate(label)}
				/>
				<Line
					dataKey="financingBalance"
					dot={{ fill: LINE_COLOR, r: DOT_RADIUS }}
					stroke={LINE_COLOR}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}

const MARGIN_COLUMNS: FinTableColumn<MarginRowData>[] = [
	{ key: "date", label: "日期", render: (row) => formatDate(row.date) },
	{
		align: "right",
		key: "financingBalance",
		label: "融资余额",
		render: (row) => formatCompact(row.financingBalance, { cny: true }),
	},
	{
		align: "right",
		key: "financingBuy",
		label: "融资买入额",
		render: (row) => formatCompact(row.financingBuy, { cny: true }),
	},
	{
		align: "right",
		key: "securitiesBalance",
		label: "融券余额",
		render: (row) => formatCompact(row.securitiesBalance, { cny: true }),
	},
	{
		align: "right",
		key: "financingBalanceRatio",
		label: "融资余额占比",
		render: (row) => formatRatio(row.financingBalanceRatio),
	},
];

/** finance_margin → 融资融券, newest `date` first (the tool already returns
 * rows in that order). Renders a line chart of 融资余额 (financing balance)
 * over time — reversed to chronological order for the x-axis — plus a
 * compact table of the same rows in source (newest-first) order. */
export function MarginChart({ data }: { data: MarginRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const chartData: ChartRow[] = [...data].reverse().map((row) => ({
		date: row.date,
		financingBalance: row.financingBalance,
	}));
	return (
		<CardShell title="融资融券">
			<MarginBalanceLine data={chartData} />
			<FinTable
				columns={MARGIN_COLUMNS}
				getRowKey={(row, index) => `${row.date}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
