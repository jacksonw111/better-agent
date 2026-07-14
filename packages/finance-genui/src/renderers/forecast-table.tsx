"use client";

import { DataTable } from "./data-table";
import type { ForecastRowData } from "./finance-schemas-fe8";
import { forecastColumns } from "./forecast-columns";

// Phase 1 Batch B1 — `earnings_forecast` on the `DataTable` primitive (design
// doc §9): one sortable row per fiscal year (this FY / next / +2). No Pivot
// chart or row expand — see forecast-columns.ts for why the metric columns
// stay sortable-but-not-`isMetric`, and every field here is already a
// visible column, so there's nothing left to reveal via `renderExpanded`.

/** finance_earnings_forecast → 盈利预测(一致预期), one row per fiscal year.
 * The 营收 column only renders when at least one row actually carries
 * `revenue` — it's optional on ForecastRow. */
export function ForecastTable({ data }: { data: ForecastRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const hasRevenue = data.some((row) => row.revenue !== null);
	const columns = forecastColumns(hasRevenue);
	return (
		<DataTable<ForecastRowData>
			categoryKey="year"
			columns={columns}
			getRowKey={(row, index) => `${row.year}-${index}`}
			rows={data}
			subtitle={`${data.length} 年`}
			title="盈利预测(一致预期)"
		/>
	);
}
