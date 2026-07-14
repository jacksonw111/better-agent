"use client";

import { DataTable } from "./data-table";
import type { LockupRowData } from "./finance-schemas-fe13";
import { formatDate } from "./format";
import { lockupColumns } from "./lockup-columns";
import { expandedMetricFields } from "./metric-expand";
import { StatGrid } from "./primitives";

// Phase 1 Batch B3 — `lockup` on the `DataTable` primitive (design doc §9):
// one row per 限售解禁 event, categoryKey `freeDate`. See lockup-columns.ts
// for the isMetric/filters judgment calls. Copies statements-table.tsx's
// shape otherwise.

/** finance_lockup → 限售解禁, soonest `freeDate` first for a market-wide
 * query, newest-first history for a single symbol (the tool already returns
 * rows in the right order for each case). */
export function LockupTable({ data }: { data: LockupRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = lockupColumns();
	return (
		<DataTable<LockupRowData>
			categoryFormat={formatDate}
			categoryKey="freeDate"
			chartKind="bar"
			columns={columns}
			getRowKey={(row, index) => `${row.code}-${row.freeDate}-${index}`}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={expandedMetricFields(columns, row)} />
			)}
			rows={data}
			subtitle={`${data.length} 笔`}
			title="限售解禁"
		/>
	);
}
