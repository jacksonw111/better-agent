"use client";

import { BarSeries } from "./bar-series";
import type { BarSeriesSeries } from "./bar-series-types";
import type { MoneyFlowRowData } from "./finance-schemas-fe6";
import { changeColor, formatCompact, formatDate } from "./format";
import type { FinTableColumn } from "./primitives";

// Phase 2 Task 1 — `money_flow` on the `BarSeries` archetype (design doc §9:
// BarSeries · I·F·P·Pv). Fixes 病根 #3 (§0/§5.3): the four buckets used to
// all share 红涨绿跌 sign color, making "which bucket is which" unreadable.
// BarSeries's `coloring="composition"` gives each bucket its own hue
// (`compositionHueRamp`), sign is read off the zero axis instead — and
// isolating a single bucket via its Filter chip switches it back to sign
// color, since direction is then unambiguous.

const MAX_CHART_DAYS = 10;

const MONEY_FLOW_SERIES: BarSeriesSeries<MoneyFlowRowData>[] = [
	{ key: "superNet", label: "超大单" },
	{ key: "largeNet", label: "大单" },
	{ key: "mediumNet", label: "中单" },
	{ key: "smallNet", label: "小单" },
];

function mainNetStyle(value: number): { color?: string } {
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
			<span style={mainNetStyle(row.mainNet)}>
				{formatCompact(row.mainNet)}
			</span>
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

/** finance_money_flow → daily 主力/超大/大/中/小单 net flow, newest `date`
 * first (the tool already returns rows in that order). Renders the most
 * recent MAX_CHART_DAYS days as a composition-colored grouped bar chart
 * (Pivot ⇄ a table of the same rows). */
export function MoneyFlowChart({ data }: { data: MoneyFlowRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const recent = data.slice(0, MAX_CHART_DAYS);
	return (
		<BarSeries<MoneyFlowRowData>
			categoryFormat={formatDate}
			categoryKey="date"
			coloring="composition"
			getRowKey={(row, index) => `${row.date}-${index}`}
			rows={recent}
			series={MONEY_FLOW_SERIES}
			tableColumns={MONEY_FLOW_COLUMNS}
			title="资金流向"
		/>
	);
}
