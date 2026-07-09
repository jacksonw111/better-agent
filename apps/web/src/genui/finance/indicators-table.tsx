"use client";

import type { ReactNode } from "react";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Legend,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { IndicatorRowData } from "./finance-schemas";
import {
	formatCompact,
	formatDate,
	formatNum,
	formatPct,
	formatRatio,
} from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const CHART_HEIGHT = 240;
const TICK_FONT_SIZE = 11;
const LEGEND_FONT_SIZE = 11;
const LINE_STROKE_WIDTH = 2;
const DOT_RADIUS = 3;
const BAR_RADIUS_TOP = 3;
const BAR_RADIUS_BOTTOM = 0;
const BAR_RADIUS: [number, number, number, number] = [
	BAR_RADIUS_TOP,
	BAR_RADIUS_TOP,
	BAR_RADIUS_BOTTOM,
	BAR_RADIUS_BOTTOM,
];
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };
const LEGEND_STYLE = { fontSize: LEGEND_FONT_SIZE };
// Amounts (revenue/net profit) aren't a signed change series, so 红涨绿跌
// doesn't apply — distinct hues per series instead, matched to the YoY line
// that tracks the same metric.
const REVENUE_COLOR = "#3b82f6"; // blue
const NET_PROFIT_COLOR = "#8b5cf6"; // violet
const REVENUE_YOY_COLOR = "#93c5fd"; // light blue
const NET_PROFIT_YOY_COLOR = "#c4b5fd"; // light violet
const GRID_COLOR = "var(--border)";
const AMOUNT_AXIS_ID = "amount";
const PCT_AXIS_ID = "pct";

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

const YOY_NAMES = new Set(["营收同比", "净利同比"]);

interface ChartRow {
	label: string;
	netProfit: number | null;
	netProfitYoy: number | null;
	revenue: number | null;
	revenueYoy: number | null;
}

function tooltipFormatter(value: unknown, name: string): [string, string] {
	if (YOY_NAMES.has(name)) {
		return [formatPct(Number(value)), name];
	}
	return [formatCompact(Number(value)), name];
}

function pctAxisTick(value: number): string {
	return `${value}%`;
}

function amountAxisTick(value: number): string {
	return formatCompact(value);
}

/** The two y-axes (left = amount, right = %) as a plain-function helper
 * (not a component) so its returned elements are spliced directly into
 * ComposedChart's children — recharts only recognizes Bar/Line/YAxis etc.
 * as its own direct children, not ones nested inside a custom component. */
function renderIndicatorAxes(): ReactNode[] {
	return [
		<YAxis
			key="amount-axis"
			stroke="var(--muted-foreground)"
			tick={{ fontSize: TICK_FONT_SIZE }}
			tickFormatter={amountAxisTick}
			yAxisId={AMOUNT_AXIS_ID}
		/>,
		<YAxis
			key="pct-axis"
			orientation="right"
			stroke="var(--muted-foreground)"
			tick={{ fontSize: TICK_FONT_SIZE }}
			tickFormatter={pctAxisTick}
			yAxisId={PCT_AXIS_ID}
		/>,
	];
}

/** 营收/归母净利 bars on the left amount axis — see renderIndicatorAxes for
 * why this stays a plain function rather than a component. */
function renderIndicatorBars(): ReactNode[] {
	return [
		<Bar
			dataKey="revenue"
			fill={REVENUE_COLOR}
			key="revenue"
			name="营收"
			radius={BAR_RADIUS}
			yAxisId={AMOUNT_AXIS_ID}
		/>,
		<Bar
			dataKey="netProfit"
			fill={NET_PROFIT_COLOR}
			key="netProfit"
			name="归母净利"
			radius={BAR_RADIUS}
			yAxisId={AMOUNT_AXIS_ID}
		/>,
	];
}

/** 营收同比/净利同比 lines on the right percent axis. */
function renderIndicatorYoyLines(): ReactNode[] {
	return [
		<Line
			dataKey="revenueYoy"
			dot={{ fill: REVENUE_YOY_COLOR, r: DOT_RADIUS }}
			key="revenueYoy"
			name="营收同比"
			stroke={REVENUE_YOY_COLOR}
			strokeWidth={LINE_STROKE_WIDTH}
			type="monotone"
			yAxisId={PCT_AXIS_ID}
		/>,
		<Line
			dataKey="netProfitYoy"
			dot={{ fill: NET_PROFIT_YOY_COLOR, r: DOT_RADIUS }}
			key="netProfitYoy"
			name="净利同比"
			stroke={NET_PROFIT_YOY_COLOR}
			strokeWidth={LINE_STROKE_WIDTH}
			type="monotone"
			yAxisId={PCT_AXIS_ID}
		/>,
	];
}

function IndicatorsComposed({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<ComposedChart data={data} margin={CHART_MARGIN}>
				<CartesianGrid
					stroke={GRID_COLOR}
					strokeDasharray="3 3"
					vertical={false}
				/>
				<XAxis
					dataKey="label"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
				/>
				{renderIndicatorAxes()}
				<Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
				<Legend wrapperStyle={LEGEND_STYLE} />
				{renderIndicatorBars()}
				{renderIndicatorYoyLines()}
			</ComposedChart>
		</ResponsiveContainer>
	);
}

function indicatorLabel(row: IndicatorRowData): string {
	return row.reportName || formatDate(row.reportDate);
}

const INDICATOR_COLUMNS: FinTableColumn<IndicatorRowData>[] = [
	{
		key: "reportName",
		label: "报告期",
		render: (row) => row.reportName || formatDate(row.reportDate),
	},
	{
		align: "right",
		key: "revenue",
		label: "营收",
		render: (row) => formatCompact(row.revenue),
	},
	{
		align: "right",
		key: "revenueYoy",
		label: "营收同比",
		render: (row) => <ChangePct value={row.revenueYoy} />,
	},
	{
		align: "right",
		key: "netProfit",
		label: "归母净利",
		render: (row) => formatCompact(row.netProfit),
	},
	{
		align: "right",
		key: "netProfitYoy",
		label: "净利同比",
		render: (row) => <ChangePct value={row.netProfitYoy} />,
	},
	{
		align: "right",
		key: "grossMargin",
		label: "毛利率",
		render: (row) => formatRatio(row.grossMargin),
	},
	{
		align: "right",
		key: "netMargin",
		label: "净利率",
		render: (row) => formatRatio(row.netMargin),
	},
	{
		align: "right",
		key: "roe",
		label: "ROE",
		render: (row) => formatRatio(row.roe),
	},
	{
		align: "right",
		key: "debtRatio",
		label: "资产负债率",
		render: (row) => formatRatio(row.debtRatio),
	},
	{
		align: "right",
		key: "eps",
		label: "EPS",
		render: (row) => formatNum(row.eps),
	},
	{
		align: "right",
		key: "opCashPerShare",
		label: "每股现金流",
		render: (row) => formatNum(row.opCashPerShare),
	},
];

/** finance_financial_indicators → a ComposedChart (营收/归母净利 as bars on
 * the left amount axis, their YoY% as lines on a right percent axis, in
 * chronological order) plus the full dense FinTable of every reporting
 * period, newest first (the tool already returns rows in that order). */
export function IndicatorsTable({ data }: { data: IndicatorRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const chartData: ChartRow[] = [...data].reverse().map((row) => ({
		label: indicatorLabel(row),
		netProfit: row.netProfit,
		netProfitYoy: row.netProfitYoy,
		revenue: row.revenue,
		revenueYoy: row.revenueYoy,
	}));
	return (
		<CardShell title="财务指标">
			<IndicatorsComposed data={chartData} />
			<FinTable
				columns={INDICATOR_COLUMNS}
				getRowKey={(row) => row.reportDate}
				rows={data}
			/>
		</CardShell>
	);
}
