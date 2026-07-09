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
import type { YieldPointData } from "./finance-schemas-fe6";
import { formatDate, formatNum } from "./format";
import { CardShell } from "./primitives";

const CHART_HEIGHT = 220;
const TICK_FONT_SIZE = 11;
const LINE_STROKE_WIDTH = 2;
const DOT_RADIUS = 3;
// Neutral blue — a yield curve isn't a signed change series, so 红涨绿跌
// doesn't apply here.
const LINE_COLOR = "#3b82f6";
const GRID_COLOR = "var(--border)";

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

interface ChartRow {
	tenor: string;
	yield: number | null;
}

function formatYieldTick(value: number): string {
	return `${value.toFixed(1)}%`;
}

function YieldCurveBody({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
				<CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
				<XAxis
					dataKey="tenor"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
				/>
				<YAxis
					domain={["auto", "auto"]}
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={formatYieldTick}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					formatter={(value) => [`${formatNum(Number(value))}%`, "收益率"]}
					labelFormatter={(label: string) => `期限 ${label}`}
				/>
				<Line
					dataKey="yield"
					dot={{ fill: LINE_COLOR, r: DOT_RADIUS }}
					stroke={LINE_COLOR}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}

/** finance_yield_curve → US Treasury yield curve (1M..30Y), a smooth line
 * chart with tenor on the x-axis and yield% on the y-axis. Tenor order comes
 * from the tool result (already 1M..30Y) — this component doesn't re-sort. */
export function YieldCurveChart({ data }: { data: YieldPointData[] }) {
	if (data.length === 0) {
		return null;
	}
	const chartData: ChartRow[] = data.map((point) => ({
		tenor: point.tenor,
		yield: point.yield,
	}));
	return (
		<CardShell subtitle={formatDate(data[0]?.date)} title="美债收益率曲线">
			<YieldCurveBody data={chartData} />
		</CardShell>
	);
}
