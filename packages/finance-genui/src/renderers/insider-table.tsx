"use client";

import { DataTable } from "./data-table";
import type { InsiderRowData } from "./finance-schemas-fe15";
import { formatDate } from "./format";
import { INSIDER_FILTERS, insiderColumns } from "./insider-columns";
import { expandedAllFields } from "./metric-expand";
import { StatGrid } from "./primitives";

// Phase 1 Batch B2 — `insider_trades` on the `DataTable` primitive (design
// doc §9): one row per 高管/股东增减持 event, categoryKey `changeDate`.
// 增持/减持 filters mirror `DirectionBadge`'s own sign-of-`changeShares`
// derivation (source `holdType` labels vary, so direction is never trusted
// from that field — see insider-columns.tsx). Copies statements-table.tsx's
// shape otherwise.

/** finance_insider_trades → 高管/股东增减持, newest `changeDate` first (the
 * tool already returns rows in that order). */
export function InsiderTable({ data }: { data: InsiderRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = insiderColumns();
	return (
		<DataTable<InsiderRowData>
			categoryFormat={formatDate}
			categoryKey="changeDate"
			columns={columns}
			filterMode="single"
			filters={INSIDER_FILTERS}
			getRowKey={(row, index) => `${row.code}-${row.changeDate}-${index}`}
			renderExpanded={(row) => (
				<StatGrid
					cols={2}
					items={expandedAllFields(columns, row, "changeDate")}
				/>
			)}
			rows={data}
			subtitle={`${data.length} 笔`}
			title="高管/股东增减持"
		/>
	);
}
