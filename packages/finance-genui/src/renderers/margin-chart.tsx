"use client";

import type { MarginRowData } from "./finance-schemas-fe11";
import { formatCompact, formatDate, formatRatio } from "./format";
import { LineSeries } from "./line-series";
import type { LineSeriesSeriesConfig } from "./line-series-types";
import type { FinTableColumn } from "./primitives";

// Phase 2 Task 3 — `margin` (融资融券) on the `LineSeries` archetype (design
// doc §9: LineSeries · I·Se·P·C). Two lines — 融资余额 and 融券余额 — each a
// distinct composition-ramp hue; the Series chips (§3 "Se") toggle 融资/融券
// on and off, multiple selected overlays them for comparison (§3 "C"). The
// tool already returns both balances in raw yuan (confirmed against the
// finance_margin registry fixture: financingBalance ~1.5e12), so — unlike
// hsgt_flow's 万元-scale fields — no unit scaling is needed here; `value`
// accessors default to the raw `row[key]` read.

const MARGIN_SERIES: LineSeriesSeriesConfig<MarginRowData>[] = [
	{ key: "financingBalance", label: "融资余额" },
	{ key: "securitiesBalance", label: "融券余额" },
];

function marginValueFormat(value: number): string {
	return formatCompact(value, { cny: true });
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
 * rows in that order; LineSeries reorders the chart branch to chronological
 * internally and leaves the table branch in source order). */
export function MarginChart({ data }: { data: MarginRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<LineSeries<MarginRowData>
			categoryFormat={formatDate}
			categoryKey="date"
			getRowKey={(row, index) => `${row.date}-${index}`}
			rows={data}
			series={MARGIN_SERIES}
			tableColumns={MARGIN_COLUMNS}
			title="融资融券"
			valueFormat={marginValueFormat}
		/>
	);
}
