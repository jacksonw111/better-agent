"use client";

import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { MoneyFlowRowData } from "./finance-schemas-fe6";
import { changeColor, formatCompact, formatDate } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const CHART_HEIGHT = 220;
const MAX_CHART_DAYS = 10;
const NEUTRAL_BAR_COLOR = "#9ca3af";
const TICK_FONT_SIZE = 11;
const GRID_COLOR = "var(--border)";

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

interface ChartRow {
	date: string;
	largeNet: number;
	mediumNet: number;
	smallNet: number;
	superNet: number;
}

type ChartBucketKey = "largeNet" | "mediumNet" | "smallNet" | "superNet";

const BUCKETS: { key: ChartBucketKey; label: string }[] = [
	{ key: "superNet", label: "超大单" },
	{ key: "largeNet", label: "大单" },
	{ key: "mediumNet", label: "中单" },
	{ key: "smallNet", label: "小单" },
];

/** 红涨绿跌: net inflow (positive) is red, outflow (negative) is green, exact
 * zero renders neutral gray rather than guessing a direction. */
function barColor(value: number): string {
	return changeColor(value) ?? NEUTRAL_BAR_COLOR;
}

const AXIS_LABEL_LENGTH = 5; // "MM-DD" tail of the formatted date

function formatAxisTick(date: string): string {
	return formatDate(date).slice(-AXIS_LABEL_LENGTH);
}

function MoneyFlowBars({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
				<CartesianGrid
					stroke={GRID_COLOR}
					strokeDasharray="3 3"
					vertical={false}
				/>
				<XAxis
					dataKey="date"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={formatAxisTick}
				/>
				<YAxis
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={(value: number) => formatCompact(value)}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					cursor={{ fill: "var(--muted)", opacity: 0.3 }}
					formatter={(value, name) => [formatCompact(Number(value)), name]}
					labelFormatter={(label: string) => formatDate(label)}
				/>
				{BUCKETS.map((bucket) => (
					<Bar dataKey={bucket.key} key={bucket.key} name={bucket.label}>
						{data.map((row) => (
							<Cell
								fill={barColor(row[bucket.key])}
								key={`${bucket.key}-${row.date}`}
							/>
						))}
					</Bar>
				))}
			</BarChart>
		</ResponsiveContainer>
	);
}

function mainNetCell(value: number): { color: string | undefined } {
	return { color: changeColor(value) ?? undefined };
}

const MONEY_FLOW_COLUMNS: FinTableColumn<MoneyFlowRowData>[] = [
	{
		key: "date",
		label: "日期",
		render: (row) => formatDate(row.date),
	},
	{
		align: "right",
		key: "mainNet",
		label: "主力净流入",
		render: (row) => (
			<span style={mainNetCell(row.mainNet)}>{formatCompact(row.mainNet)}</span>
		),
	},
	{
		align: "right",
		key: "superNet",
		label: "超大单",
		render: (row) => formatCompact(row.superNet),
	},
	{
		align: "right",
		key: "largeNet",
		label: "大单",
		render: (row) => formatCompact(row.largeNet),
	},
	{
		align: "right",
		key: "mediumNet",
		label: "中单",
		render: (row) => formatCompact(row.mediumNet),
	},
	{
		align: "right",
		key: "smallNet",
		label: "小单",
		render: (row) => formatCompact(row.smallNet),
	},
];

/** finance_money_flow → daily 主力/超大/大/中/小单 net flow, newest `date` first
 * (the tool already returns rows in that order). Renders a grouped bar chart
 * of the most recent MAX_CHART_DAYS days (reversed to chronological order for
 * the x-axis) plus a compact table of the same rows in source (newest-first)
 * order. */
export function MoneyFlowChart({ data }: { data: MoneyFlowRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const recentDesc = data.slice(0, MAX_CHART_DAYS);
	const chartData = [...recentDesc].reverse().map((row) => ({
		date: row.date,
		largeNet: row.largeNet,
		mediumNet: row.mediumNet,
		smallNet: row.smallNet,
		superNet: row.superNet,
	}));
	return (
		<CardShell title="资金流向">
			<MoneyFlowBars data={chartData} />
			<FinTable
				columns={MONEY_FLOW_COLUMNS}
				getRowKey={(row, index) => `${row.date}-${index}`}
				rows={recentDesc}
			/>
		</CardShell>
	);
}
