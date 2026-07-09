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
import type { HsgtRowData } from "./finance-schemas";
import { changeColor, formatCompact, formatDate } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

// EastMoney reports HSGT flow amounts in 万元 (ten-thousand-yuan units); scale
// up to raw yuan before handing to `formatCompact`, which auto-picks the
// 万/亿/万亿 suffix from the magnitude.
const WAN_TO_YUAN = 1e4;
const CHART_HEIGHT = 200;
const TICK_FONT_SIZE = 11;
const NEUTRAL_BAR_COLOR = "#9ca3af";
const GRID_COLOR = "var(--border)";
const AXIS_LABEL_LENGTH = 5; // "MM-DD" tail of the formatted date

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

function toYuan(wan: number | null): number | null {
	return wan === null ? null : wan * WAN_TO_YUAN;
}

const DIRECTION_LABEL: Record<HsgtRowData["direction"], string> = {
	north: "北向",
	south: "南向",
};

function NetFlowCell({ value }: { value: number | null }) {
	if (value === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	const yuan = toYuan(value);
	const color = changeColor(value);
	const sign = value > 0 ? "+" : "";
	return (
		<span style={color ? { color } : undefined}>
			{sign}
			{formatCompact(yuan, { cny: true })}
		</span>
	);
}

interface SouthFlowRow {
	date: string;
	netAmt: number; // yuan, summed across every southbound channel for the date
}

/** 红涨绿跌: net inflow (positive) is red, outflow (negative) is green, exact
 * zero renders neutral gray rather than guessing a direction. */
function barColor(value: number): string {
	return changeColor(value) ?? NEUTRAL_BAR_COLOR;
}

function formatAxisTick(date: string): string {
	return formatDate(date).slice(-AXIS_LABEL_LENGTH);
}

/** Sums southbound (南向, e.g. 港股通(沪)/港股通(深)) net flow across every
 * channel per trade date, chronological order. Rows with a null `netAmt` are
 * skipped — that's always the northbound (北向) rows, undisclosed since
 * 2024-08-19, since this only scans `direction === "south"`. */
function buildSouthFlowSeries(rows: HsgtRowData[]): SouthFlowRow[] {
	const netByDate = new Map<string, number>();
	for (const row of rows) {
		if (row.direction !== "south" || row.netAmt === null) {
			continue;
		}
		netByDate.set(
			row.tradeDate,
			(netByDate.get(row.tradeDate) ?? 0) + row.netAmt
		);
	}
	return [...netByDate.entries()]
		.map(([date, netAmtWan]) => ({ date, netAmt: netAmtWan * WAN_TO_YUAN }))
		.sort((a, b) => a.date.localeCompare(b.date));
}

function SouthFlowBars({ data }: { data: SouthFlowRow[] }) {
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
					formatter={(value) => [
						formatCompact(Number(value), { cny: true }),
						"南向净流入",
					]}
					labelFormatter={(label: string) => formatDate(label)}
				/>
				<Bar dataKey="netAmt">
					{data.map((row) => (
						<Cell fill={barColor(row.netAmt)} key={row.date} />
					))}
				</Bar>
			</BarChart>
		</ResponsiveContainer>
	);
}

const HSGT_COLUMNS: FinTableColumn<HsgtRowData>[] = [
	{
		key: "tradeDate",
		label: "日期",
		render: (row) => formatDate(row.tradeDate),
	},
	{
		key: "channel",
		label: "通道",
		render: (row) => row.channel || "—",
	},
	{
		key: "direction",
		label: "方向",
		render: (row) => DIRECTION_LABEL[row.direction],
	},
	{
		align: "right",
		key: "netAmt",
		label: "净流入",
		render: (row) => <NetFlowCell value={row.netAmt} />,
	},
	{
		align: "right",
		key: "buyAmt",
		label: "买入额",
		render: (row) => formatCompact(toYuan(row.buyAmt), { cny: true }),
	},
	{
		align: "right",
		key: "sellAmt",
		label: "卖出额",
		render: (row) => formatCompact(toYuan(row.sellAmt), { cny: true }),
	},
	{
		key: "leadStock",
		label: "领涨股",
		render: (row) => row.leadStock ?? "—",
	},
];

/** finance_hsgt_flow → 沪深港通资金流 by channel, newest `tradeDate` first
 * (the tool already returns rows in that order). A bar chart of daily
 * southbound (南向) net flow leads — red inflow / green outflow (红涨绿跌),
 * chronological — followed by the full per-channel table. Northbound
 * (沪股通/深股通) net flow is null on every row since mainland exchanges
 * stopped disclosing it on 2024-08-19 — a note surfaces that instead of a
 * bare dash reading as missing data. */
export function HsgtTable({ data }: { data: HsgtRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const hasSuppressedNorth = data.some(
		(row) => row.direction === "north" && row.netAmt === null
	);
	const southFlow = buildSouthFlowSeries(data);
	return (
		<CardShell title="沪深港通资金流">
			{southFlow.length > 0 ? <SouthFlowBars data={southFlow} /> : null}
			<FinTable
				columns={HSGT_COLUMNS}
				getRowKey={(row, index) => `${row.tradeDate}-${row.channel}-${index}`}
				rows={data}
			/>
			{hasSuppressedNorth ? (
				<p className="text-muted-foreground text-xs">
					北向资金净流入自2024年8月19日起不再披露
				</p>
			) : null}
		</CardShell>
	);
}
