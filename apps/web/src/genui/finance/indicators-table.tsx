"use client";

import { DataTable } from "./data-table";
import type { IndicatorRowData } from "./finance-schemas";
import { formatDate } from "./format";
import { indicatorColumns } from "./indicators-columns";
import { expandedMetricFields } from "./metric-expand";
import { StatGrid } from "./primitives";

// Phase 1 Batch B1 — `financial_indicators` on the `DataTable` primitive
// (design doc §9), replacing the bespoke ComposedChart + FinTable pair with
// the shared archetype: reportDate rows × ratio/amount metric columns,
// Pivot-able to a multi-metric line chart. Copies statements-table.tsx's
// shape exactly (see that file for the pattern this generalizes).

/** finance_financial_indicators → one DataTable row per reporting period.
 * Rows arrive newest-first; DataTable itself handles chronological reversal
 * for the chart Pivot, so this never pre-sorts. */
export function IndicatorsTable({ data }: { data: IndicatorRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = indicatorColumns();
	return (
		<DataTable<IndicatorRowData>
			categoryFormat={formatDate}
			categoryKey="reportDate"
			chartKind="line"
			columns={columns}
			getRowKey={(row) => row.reportDate}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={expandedMetricFields(columns, row)} />
			)}
			rows={data}
			subtitle={`${data.length} 期`}
			title="财务指标"
		/>
	);
}
