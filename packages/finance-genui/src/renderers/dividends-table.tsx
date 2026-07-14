"use client";

import { DataTable } from "./data-table";
import { dividendColumns } from "./dividends-columns";
import type { DividendRowData } from "./finance-schemas";
import { formatDate } from "./format";
import { expandedMetricFields } from "./metric-expand";
import { StatGrid } from "./primitives";

// Phase 1 Batch B1 — `dividends` on the `DataTable` primitive (design doc
// §9), replacing the bare FinTable with the shared archetype: reportDate
// rows × the same six columns, `pretaxDividendRmb` plottable as a bar series
// (dividend-per-period reads better as bars than a line — spec §9). Copies
// statements-table.tsx's shape (see that file for the pattern this
// generalizes).

/** finance_dividends → 分红方案, newest `reportDate` first (the tool already
 * returns rows in that order; DataTable handles chronological reversal for
 * the chart Pivot, so this never pre-sorts). Multiple plans can share a
 * `reportDate` (amendments), so `getRowKey` includes the row index. */
export function DividendsTable({ data }: { data: DividendRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = dividendColumns();
	return (
		<DataTable<DividendRowData>
			categoryFormat={formatDate}
			categoryKey="reportDate"
			chartKind="bar"
			columns={columns}
			getRowKey={(row, index) => `${row.reportDate}-${index}`}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={expandedMetricFields(columns, row)} />
			)}
			rows={data}
			subtitle={`${data.length} 期`}
			title="分红方案"
		/>
	);
}
