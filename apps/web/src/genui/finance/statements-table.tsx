"use client";

import { DataTable } from "./data-table";
import type { DataTableColumn, DataTablePeriod } from "./data-table-types";
import type { StatementRowData } from "./finance-schemas";
import { formatDate } from "./format";
import { StatGrid, type StatGridItem } from "./primitives";
import {
	detectStatementKind,
	STATEMENT_TITLES,
	statementColumns,
} from "./statements-columns";

// Phase 1 Task 2 — the `financial_statements` flagship DataTable (design doc
// §8.1's worked example): reportDate rows × income/balance/cashflow metric
// columns, Pivot-able to a multi-metric line chart, Period-able to 年报/季报.
// This is the exemplar the remaining 11 DataTable tools (§9) copy — keep the
// shape (kind-detection → column set → DataTable props) obvious.

/** A reportDate ending 12-31 is the annual report; anything else (03-31,
 * 06-30, 09-30, …) is a quarterly one. This is the standard A-share reporting
 * calendar convention, not a payload-declared field, so it's derived rather
 * than trusted from a discriminator — reliable enough to filter on. */
const ANNUAL_REPORT_SUFFIX = "-12-31";
const ALL_PERIOD_ID = "all";

const STATEMENT_PERIODS: DataTablePeriod<StatementRowData>[] = [
	{ id: ALL_PERIOD_ID, label: "全部", predicate: () => true },
	{
		id: "annual",
		label: "年报",
		predicate: (row) => row.reportDate.endsWith(ANNUAL_REPORT_SUFFIX),
	},
	{
		id: "quarter",
		label: "季报",
		predicate: (row) => !row.reportDate.endsWith(ANNUAL_REPORT_SUFFIX),
	},
];

/** Expand (§3): every non-null metric field for the single reporting period
 * the user drilled into, rendered with the same formatter as its column. */
function expandedFields(
	columns: DataTableColumn<StatementRowData>[],
	row: StatementRowData
): StatGridItem[] {
	const items: StatGridItem[] = [];
	for (const col of columns) {
		if (!(col.isMetric && col.value)) {
			continue;
		}
		const raw = col.value(row);
		if (raw === null) {
			continue;
		}
		items.push({ label: col.label, value: col.render?.(row) ?? raw });
	}
	return items;
}

/** finance_financial_statements → one DataTable row per reporting period.
 * Column set (income/balance/cashflow) is picked from the detected kind since
 * the payload carries no explicit statement-type field (see
 * statements-columns.ts). Rows arrive newest-first; DataTable itself handles
 * chronological reversal for the chart Pivot, so this never pre-sorts. */
export function StatementsTable({ data }: { data: StatementRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const kind = detectStatementKind(data);
	const columns = statementColumns(kind);
	return (
		<DataTable<StatementRowData>
			categoryFormat={formatDate}
			categoryKey="reportDate"
			chartKind="line"
			columns={columns}
			getRowKey={(row) => row.reportDate}
			periods={STATEMENT_PERIODS}
			renderExpanded={(row) => (
				<StatGrid cols={2} items={expandedFields(columns, row)} />
			)}
			rows={data}
			subtitle={`${data.length} 期`}
			title={STATEMENT_TITLES[kind]}
		/>
	);
}
