"use client";

import { DataTable } from "./data-table";
import type { SuspensionRowData } from "./finance-schemas-fe15";
import { formatDate } from "./format";
import { StatGrid } from "./primitives";
import {
	suspensionColumns,
	suspensionExpandedItems,
} from "./suspension-columns";

// Phase 1 Batch B3 — `suspension` on the `DataTable` primitive (design doc
// §9): one row per 停复牌 event, categoryKey `suspendStart`. See
// suspension-columns.tsx for the isMetric/filters judgment calls. Copies
// statements-table.tsx's shape otherwise.

/** finance_suspension → 停复牌, newest `suspendStart` first (the tool already
 * returns rows in that order). */
export function SuspensionTable({ data }: { data: SuspensionRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = suspensionColumns();
	return (
		<DataTable<SuspensionRowData>
			categoryFormat={formatDate}
			categoryKey="suspendStart"
			columns={columns}
			getRowKey={(row, index) => `${row.code}-${row.suspendStart}-${index}`}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={suspensionExpandedItems(columns, row)} />
			)}
			rows={data}
			subtitle={`${data.length} 笔`}
			title="停复牌"
		/>
	);
}
