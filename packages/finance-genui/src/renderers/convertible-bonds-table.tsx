"use client";

import {
	bondExpandedItems,
	convertibleBondColumns,
} from "./convertible-bonds-columns";
import { DataTable } from "./data-table";
import type { ConvertibleBondRowData } from "./finance-schemas-fe13";
import { StatGrid } from "./primitives";

// Phase 1 Batch B3 — `convertible_bonds` on the `DataTable` primitive (design
// doc §9): a bond-registry-flavored table, one row per convertible bond,
// leading with `code` (not a date/period) as the pre-DataTable component did
// — see convertible-bonds-columns.tsx for the isMetric/expand reasoning this
// drives. Copies statements-table.tsx's shape otherwise.

/** finance_convertible_bonds → 可转债, newest `listingDate` first (the tool
 * already returns rows in that order). */
export function ConvertibleBondsTable({
	data,
}: {
	data: ConvertibleBondRowData[];
}) {
	if (data.length === 0) {
		return null;
	}
	const columns = convertibleBondColumns();
	return (
		<DataTable<ConvertibleBondRowData>
			categoryKey="code"
			columns={columns}
			getRowKey={(row, index) => `${row.code}-${index}`}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={bondExpandedItems(columns, row)} />
			)}
			rows={data}
			title="可转债"
		/>
	);
}
