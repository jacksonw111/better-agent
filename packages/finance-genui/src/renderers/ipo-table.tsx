"use client";

import { DataTable } from "./data-table";
import type { IpoRowData } from "./finance-schemas-fe13";
import { formatDate } from "./format";
import { ipoColumns, ipoExpandedItems } from "./ipo-columns";
import { StatGrid } from "./primitives";

// Phase 1 Batch B4 — `ipo` on the `DataTable` primitive (design doc §9): one
// row per 新股申购 event, categoryKey `applyDate`. See ipo-columns.tsx for
// the isMetric/filters judgment calls. Copies statements-table.tsx's shape
// otherwise.

/** finance_ipo → 新股申购日历, newest `applyDate` first (the tool already
 * returns rows in that order). */
export function IpoTable({ data }: { data: IpoRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = ipoColumns();
	return (
		<DataTable<IpoRowData>
			categoryFormat={formatDate}
			categoryKey="applyDate"
			columns={columns}
			getRowKey={(row, index) => `${row.code}-${row.applyDate}-${index}`}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={ipoExpandedItems(columns, row)} />
			)}
			rows={data}
			subtitle={`${data.length} 只`}
			title="新股申购"
		/>
	);
}
