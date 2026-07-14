"use client";

import { DataTable } from "./data-table";
import type { DataTableColumn } from "./data-table-types";
import type { MacroCnRowData } from "./finance-schemas-fe7";
import {
	cnFieldLabel,
	cnFieldNumericValue,
	cnRowFields,
	formatCnFieldValue,
	indicatorLabel,
} from "./macro-fields";

// finance_macro_cn's `rows` branch (EastMoney single-indicator monthly
// report history) on the `DataTable` archetype. Columns are built at runtime
// from the row's own catchall fields (see MacroCnRowSchema) since each CN
// indicator (cpi/pmi/m2/...) exposes a different field set — there's no
// static FieldSpec list to plug into the way statements-columns.ts does.
// Numeric fields get BOTH a formatted `render` and a raw `value` accessor so
// they sort and pivot-to-line; string-only fields get neither (no invented
// numeric data). No `filters` — the payload carries no discrete field to
// filter on.

const TIME_COLUMN: DataTableColumn<MacroCnRowData> = {
	key: "time",
	label: "时间",
};

function isNumericField(rows: MacroCnRowData[], key: string): boolean {
	return rows.some((row) => typeof row[key] === "number");
}

function cnFieldColumn(
	key: string,
	numeric: boolean
): DataTableColumn<MacroCnRowData> {
	return {
		align: numeric ? "right" : "left",
		isMetric: numeric,
		key,
		label: cnFieldLabel(key),
		render: (row) => formatCnFieldValue(key, row[key]),
		value: numeric ? (row) => cnFieldNumericValue(key, row) : undefined,
	};
}

function cnRowsColumns(
	rows: MacroCnRowData[]
): DataTableColumn<MacroCnRowData>[] {
	const fields = cnRowFields(rows[0] ?? { time: null });
	return [
		TIME_COLUMN,
		...fields.map((key) => cnFieldColumn(key, isNumericField(rows, key))),
	];
}

/** finance_macro_cn → one row per report period, newest-first as the tool
 * returns them. DataTable's chart Pivot orders chronologically only when
 * `time` parses as a date/number (data-table-chart.tsx); CN's
 * "2026年06月份"-style strings don't parse, so it safely falls back to source
 * order — no pre-sort or `categoryFormat` date-parsing needed here. */
export function MacroCnRowsTable({
	indicator,
	rows,
}: {
	indicator: string;
	rows: MacroCnRowData[];
}) {
	if (rows.length === 0) {
		return null;
	}
	return (
		<DataTable<MacroCnRowData>
			categoryKey="time"
			chartKind="line"
			columns={cnRowsColumns(rows)}
			getRowKey={(row, index) => `${row.time}-${index}`}
			rows={rows}
			title={indicatorLabel(indicator)}
		/>
	);
}
