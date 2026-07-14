"use client";

import { blockTradeColumns } from "./block-trades-columns";
import { DataTable } from "./data-table";
import type { BlockTradeRowData } from "./finance-schemas-fe15";
import { formatDate } from "./format";
import { expandedAllFields } from "./metric-expand";
import { StatGrid } from "./primitives";

// Phase 1 Batch B2 — `block_trades` on the `DataTable` primitive (design doc
// §9): one row per 大宗交易, categoryKey `tradeDate`. See
// block-trades-columns.ts for the isMetric/filters judgment calls. Copies
// statements-table.tsx's shape otherwise.

/** finance_block_trades → 大宗交易, newest `tradeDate` first (the tool
 * already returns rows in that order). */
export function BlockTradesTable({ data }: { data: BlockTradeRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = blockTradeColumns();
	return (
		<DataTable<BlockTradeRowData>
			categoryFormat={formatDate}
			categoryKey="tradeDate"
			columns={columns}
			getRowKey={(row, index) => `${row.code}-${row.tradeDate}-${index}`}
			renderExpanded={(row) => (
				<StatGrid
					cols={2}
					items={expandedAllFields(columns, row, "tradeDate")}
				/>
			)}
			rows={data}
			subtitle={`${data.length} 笔`}
			title="大宗交易"
		/>
	);
}
