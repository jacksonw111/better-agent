import type { DataTableColumn } from "./data-table-types";
import type { SuspensionRowData } from "./finance-schemas-fe15";
import { formatDate } from "./format";
import type { StatGridItem } from "./primitives";

// Phase 1 Batch B3 — column config for `suspension` (design doc §9), ported
// field-for-field from the pre-DataTable suspension-table.tsx's FinTable
// columns. `suspendStart` (停牌起, the current component's date anchor) is
// the categoryKey. SuspensionRowSchema carries no numeric field at all —
// every column here is text/date — so, like `top_holders`/
// `convertible_bonds`, no column is `isMetric` (no Pivot chart, no numeric
// Sort) and `suspensionExpandedItems` below builds the row-detail expand
// directly from every non-category column's own `render`, mirroring
// `top-holders-columns.tsx`'s `holderExpandedItems`. No `filters`: `reason`
// is free text straight from EastMoney's SUSPEND_REASON field, not a
// schema-enforced enum — like block-trades' buyer/seller, spec §9's
// "filters ... if the current component distinguishes it" resolves to no
// filter for this tool.

const SUSPEND_START_COLUMN: DataTableColumn<SuspensionRowData> = {
	key: "suspendStart",
	label: "停牌起",
	render: (row) => formatDate(row.suspendStart),
};

const NAME_COLUMN: DataTableColumn<SuspensionRowData> = {
	key: "name",
	label: "名称",
	render: (row) => row.name || row.code || "—",
};

const CODE_COLUMN: DataTableColumn<SuspensionRowData> = {
	key: "code",
	label: "代码",
	render: (row) => row.code || "—",
};

const SUSPEND_END_COLUMN: DataTableColumn<SuspensionRowData> = {
	key: "suspendEnd",
	label: "复牌",
	render: (row) => (row.suspendEnd ? formatDate(row.suspendEnd) : "—"),
};

const EXPIRE_COLUMN: DataTableColumn<SuspensionRowData> = {
	key: "expire",
	label: "期限",
	render: (row) => row.expire || "—",
};

const REASON_COLUMN: DataTableColumn<SuspensionRowData> = {
	key: "reason",
	label: "原因",
	render: (row) => (
		<span className="line-clamp-2 max-w-56" title={row.reason ?? undefined}>
			{row.reason || "—"}
		</span>
	),
};

const PREDICT_RESUME_COLUMN: DataTableColumn<SuspensionRowData> = {
	key: "predictResume",
	label: "预计复牌",
	render: (row) => (row.predictResume ? formatDate(row.predictResume) : "—"),
};

/** `suspendStart` (categoryKey) plus every column the pre-DataTable component
 * rendered — see the module note above for why none is `isMetric`. */
export function suspensionColumns(): DataTableColumn<SuspensionRowData>[] {
	return [
		SUSPEND_START_COLUMN,
		NAME_COLUMN,
		CODE_COLUMN,
		SUSPEND_END_COLUMN,
		EXPIRE_COLUMN,
		REASON_COLUMN,
		PREDICT_RESUME_COLUMN,
	];
}

/** Row-detail expand for a single suspension event — every non-category
 * column's own rendered cell (including the full, un-clamped 原因 text), so
 * the expand always matches what the grid shows. See the module note for why
 * this can't reuse `expandedMetricFields`. */
export function suspensionExpandedItems(
	columns: DataTableColumn<SuspensionRowData>[],
	row: SuspensionRowData
): StatGridItem[] {
	return columns
		.filter((col) => col.key !== SUSPEND_START_COLUMN.key)
		.map((col) => ({
			label: col.label,
			value: col.render ? col.render(row) : "—",
		}));
}
