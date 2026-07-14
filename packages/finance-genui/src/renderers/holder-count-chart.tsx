"use client";

import type { HolderCountRowData } from "./finance-schemas-fe12";
import { formatCompact, formatDate } from "./format";
import { LineSeries } from "./line-series";
import type { LineSeriesSeriesConfig } from "./line-series-types";
import { ChangePct, type FinTableColumn } from "./primitives";

// Phase 2 Task 3 — `holder_count` on the `LineSeries` archetype (design doc
// §9: LineSeries · I·Se·P·C), the flagship/simplest LineSeries tool: a single
// line, no Series chips (§8.3 "单一 series 不显示 chips"). A falling holder
// count usually signals chip concentration (筹码集中), generally read as
// bullish — that hint now lives in the card subtitle rather than a fixed `<p>`
// below the chart, since LineSeries's Pivot toggles the chart out of view.

const HOLDER_COUNT_HINT = "户数下降通常意味着筹码集中，一般视为利好信号";

const HOLDER_COUNT_SERIES: LineSeriesSeriesConfig<HolderCountRowData>[] = [
	{ key: "totalHolders", label: "股东户数" },
];

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
 * returns rows in that order; LineSeries reorders the chart branch to
 * chronological internally and leaves the table branch in source order). A
 * filled area reads well for a headcount trend, hence `area`. */
export function HolderCountChart({ data }: { data: HolderCountRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<LineSeries<HolderCountRowData>
			area
			categoryFormat={formatDate}
			categoryKey="endDate"
			getRowKey={(row, index) => `${row.endDate}-${index}`}
			rows={data}
			series={HOLDER_COUNT_SERIES}
			subtitle={HOLDER_COUNT_HINT}
			tableColumns={HOLDER_COUNT_COLUMNS}
			title="股东户数"
		/>
	);
}
