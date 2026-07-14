"use client";

import { DataTable } from "./data-table";
import type { PreannounceRowData } from "./finance-schemas-fe13";
import { formatDate } from "./format";
import {
	PREANNOUNCE_FILTERS,
	preannounceColumns,
	preannounceExpandedItems,
} from "./preannounce-columns";
import { StatGrid } from "./primitives";

// Phase 1 Batch B4 — `earnings_preannounce` on the `DataTable` primitive
// (design doc §9): one row per 业绩预告 event, categoryKey `noticeDate`.
// 预增/预减 filters derive straight from the schema's `type` field (see
// preannounce-columns.tsx). Was `PreannounceList` (a plain FinTable list)
// before this batch — renamed to match every other DataTable-based tool's
// `*-table.tsx`/`*Table` naming. Copies statements-table.tsx's shape
// otherwise.

/** finance_earnings_preannounce → 业绩预告, newest `noticeDate` first (the
 * tool already returns rows in that order). */
export function PreannounceTable({ data }: { data: PreannounceRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = preannounceColumns();
	return (
		<DataTable<PreannounceRowData>
			categoryFormat={formatDate}
			categoryKey="noticeDate"
			columns={columns}
			filterMode="single"
			filters={PREANNOUNCE_FILTERS}
			getRowKey={(row, index) => `${row.code}-${row.noticeDate}-${index}`}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={preannounceExpandedItems(columns, row)} />
			)}
			rows={data}
			subtitle={`${data.length} 条`}
			title="业绩预告"
		/>
	);
}
