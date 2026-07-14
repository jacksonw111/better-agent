"use client";

import type { MacroObservationData } from "./finance-schemas-fe7";
import { formatDate, formatNum } from "./format";
import { LineSeries } from "./line-series";
import type { LineSeriesSeriesConfig } from "./line-series-types";
import { indicatorLabel } from "./macro-fields";
import type { FinTableColumn } from "./primitives";

// finance_macro_us's `observations` branch (FRED single-indicator time
// series) on the `LineSeries` archetype — same single-line, no-Series-chips
// shape as holder-count-chart.tsx (the exemplar). An area fill reads well for
// an index trend (design doc §8.3).

const SERIES_COLUMNS: FinTableColumn<MacroObservationData>[] = [
	{ key: "date", label: "日期", render: (row) => formatDate(row.date) },
	{
		align: "right",
		key: "value",
		label: "数值",
		render: (row) => formatNum(row.value),
	},
];

/** finance_macro_us → a single indicator's FRED observation history. */
export function MacroSeriesChart({
	indicator,
	seriesId,
	observations,
}: {
	indicator: string;
	seriesId: string | null | undefined;
	observations: MacroObservationData[];
}) {
	if (observations.length === 0) {
		return null;
	}
	const label = indicatorLabel(indicator);
	const series: LineSeriesSeriesConfig<MacroObservationData>[] = [
		{ key: "value", label },
	];
	return (
		<LineSeries<MacroObservationData>
			area
			categoryFormat={formatDate}
			categoryKey="date"
			getRowKey={(row, index) => `${row.date}-${index}`}
			rows={observations}
			series={series}
			subtitle={seriesId ?? undefined}
			tableColumns={SERIES_COLUMNS}
			title={label}
		/>
	);
}
