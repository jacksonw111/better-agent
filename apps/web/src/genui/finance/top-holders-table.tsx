"use client";

import { DataTable } from "./data-table";
import type { HolderRowData } from "./finance-schemas";
import { formatDate } from "./format";
import { StatGrid } from "./primitives";
import { holderColumns, holderExpandedItems } from "./top-holders-columns";

// Phase 1 Batch B2 — `top_holders` on the `DataTable` primitive (design doc
// §9): a RankList-flavored table, one row per shareholder, sorted by
// 持股数/占比 rather than by date. `holder` (a shareholder name, not a
// date/period) is the categoryKey, so — unlike every other DataTable tool —
// there is deliberately no Pivot chart (see top-holders-columns.tsx for the
// isMetric/expand reasoning this drives). Copies statements-table.tsx's
// shape otherwise.

/** finance_top_holders → 十大流通股东, newest `endDate` first (the tool
 * already returns rows in that order). */
export function TopHoldersTable({ data }: { data: HolderRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = holderColumns();
	return (
		<DataTable<HolderRowData>
			categoryKey="holder"
			columns={columns}
			getRowKey={(row, index) => `${row.holder}-${index}`}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={holderExpandedItems(columns, row)} />
			)}
			rows={data}
			subtitle={formatDate(data[0]?.endDate)}
			title="十大流通股东"
		/>
	);
}
