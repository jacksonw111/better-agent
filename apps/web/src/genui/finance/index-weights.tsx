"use client";

import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { IndexWeightRowData } from "./finance-schemas-fe14";
import { formatNum, formatRatio } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const CHART_TOP_N = 15;
const TABLE_TOP_N = 30;
const CHART_HEIGHT = 320;
const CHART_ROW_HEIGHT = 22;
const TICK_FONT_SIZE = 11;
const NAME_TICK_WIDTH = 90;
// Neutral indigo accent — 权重% is a static composition figure, not a signed
// price change, so 红涨绿跌 doesn't apply (same reasoning as
// holder-count-chart.tsx / margin-chart.tsx).
const BAR_COLOR = "#6366f1";
const GRID_COLOR = "var(--border)";

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

interface ChartRow {
	name: string;
	weight: number;
}

function toChartRow(row: IndexWeightRowData): ChartRow | null {
	if (row.weight === null) {
		return null;
	}
	return { name: row.name || row.code, weight: row.weight };
}

function isChartRow(row: ChartRow | null): row is ChartRow {
	return row !== null;
}

function WeightBars({ data }: { data: ChartRow[] }) {
	const height = Math.max(CHART_HEIGHT, data.length * CHART_ROW_HEIGHT);
	return (
		<ResponsiveContainer height={height} width="100%">
			<BarChart
				data={data}
				layout="vertical"
				margin={{ top: 8, right: 24, bottom: 0, left: 8 }}
			>
				<CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
				<XAxis
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={(value: number) => formatRatio(value)}
					type="number"
				/>
				<YAxis
					dataKey="name"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					type="category"
					width={NAME_TICK_WIDTH}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					cursor={{ fill: "var(--muted)", opacity: 0.3 }}
					formatter={(value) => [formatRatio(Number(value)), "权重"]}
				/>
				<Bar dataKey="weight" fill={BAR_COLOR} name="权重" />
			</BarChart>
		</ResponsiveContainer>
	);
}

const INDEX_WEIGHT_COLUMNS: FinTableColumn<IndexWeightRowData>[] = [
	{ key: "name", label: "名称", render: (row) => row.name || row.code },
	{ key: "code", label: "代码" },
	{
		align: "right",
		key: "weight",
		label: "权重%",
		render: (row) => formatRatio(row.weight),
	},
	{
		align: "right",
		key: "closePrice",
		label: "最新价",
		render: (row) => formatNum(row.closePrice),
	},
	{
		align: "right",
		key: "changePct",
		label: "涨跌幅",
		render: (row) => <ChangePct value={row.changePct} />,
	},
	{ key: "industry", label: "行业", render: (row) => row.industry || "—" },
	{
		align: "right",
		key: "pe",
		label: "PE",
		render: (row) => formatNum(row.pe),
	},
	{
		align: "right",
		key: "roe",
		label: "ROE",
		render: (row) => formatRatio(row.roe),
	},
];

/** finance_index_weights → 指数成分权重, sorted by `weight` desc (the tool
 * already returns rows in that order), up to 300 constituents. Renders a
 * horizontal bar chart of the top CHART_TOP_N constituents by weight plus a
 * table of the top TABLE_TOP_N, with a "+N more" line for the remainder. */
export function IndexWeights({ data }: { data: IndexWeightRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const chartData = data
		.slice(0, CHART_TOP_N)
		.map(toChartRow)
		.filter(isChartRow)
		.reverse(); // reverse so the largest weight renders at the top of the bar chart
	const tableRows = data.slice(0, TABLE_TOP_N);
	const hiddenCount = data.length - tableRows.length;
	return (
		<CardShell title="指数成分权重">
			{chartData.length > 0 ? <WeightBars data={chartData} /> : null}
			<FinTable
				columns={INDEX_WEIGHT_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${index}`}
				rows={tableRows}
			/>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
