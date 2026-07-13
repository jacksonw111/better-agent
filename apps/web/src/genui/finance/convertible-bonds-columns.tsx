import { Badge } from "@better-agent/ui/components/badge";
import type { DataTableColumn } from "./data-table-types";
import type { ConvertibleBondRowData } from "./finance-schemas-fe13";
import { formatCompact, formatDate } from "./format";
import type { StatGridItem } from "./primitives";

// Phase 1 Batch B3 — column config for `convertible_bonds` (design doc §9),
// ported field-for-field from the pre-DataTable convertible-bonds-table.tsx's
// FinTable columns. `code` (债券代码, the current component's leading column)
// is the categoryKey — a bond identifier, not a date/number, so — like
// top_holders' `holder` — no column here is `isMetric` (no Pivot chart makes
// sense across an unordered set of bond codes; spec §9). That in turn means
// `metric-expand.ts`'s `expandedMetricFields` (which only surfaces
// `isMetric`+`value` columns) would return nothing for this table, so
// `bondExpandedItems` below builds the row-detail expand directly from every
// non-category column's own `render`, mirroring `top-holders-columns.tsx`'s
// `holderExpandedItems`. No `filters`: ConvertibleBondRowSchema carries no
// status/stage discriminator, so spec §9's "filters ... if the current
// component distinguishes it" resolves to no filter for this tool.

const CODE_COLUMN: DataTableColumn<ConvertibleBondRowData> = {
	key: "code",
	label: "债券代码",
	render: (row) => row.code || "—",
};

const NAME_COLUMN: DataTableColumn<ConvertibleBondRowData> = {
	key: "name",
	label: "债券名称",
	render: (row) => row.name || "—",
};

const STOCK_CODE_COLUMN: DataTableColumn<ConvertibleBondRowData> = {
	key: "stockCode",
	label: "正股代码",
	render: (row) => row.stockCode || "—",
};

const RATING_COLUMN: DataTableColumn<ConvertibleBondRowData> = {
	key: "rating",
	label: "评级",
	render: (row) =>
		row.rating ? <Badge variant="outline">{row.rating}</Badge> : "—",
};

const LISTING_DATE_COLUMN: DataTableColumn<ConvertibleBondRowData> = {
	key: "listingDate",
	label: "上市日",
	render: (row) => formatDate(row.listingDate),
};

const EXPIRE_DATE_COLUMN: DataTableColumn<ConvertibleBondRowData> = {
	key: "expireDate",
	label: "到期日",
	render: (row) => formatDate(row.expireDate),
};

const ISSUE_SCALE_COLUMN: DataTableColumn<ConvertibleBondRowData> = {
	align: "right",
	key: "issueScale",
	label: "发行规模",
	render: (row) => formatCompact(row.issueScale, { cny: true }),
	value: (row) => row.issueScale,
};

/** `code` (categoryKey) plus every column the pre-DataTable component
 * rendered — `issueScale` is sortable-only, deliberately not `isMetric`; see
 * the module note above. */
export function convertibleBondColumns(): DataTableColumn<ConvertibleBondRowData>[] {
	return [
		CODE_COLUMN,
		NAME_COLUMN,
		STOCK_CODE_COLUMN,
		RATING_COLUMN,
		LISTING_DATE_COLUMN,
		EXPIRE_DATE_COLUMN,
		ISSUE_SCALE_COLUMN,
	];
}

/** Row-detail expand for a single bond — every non-category column's own
 * rendered cell, so the expand always matches what the grid shows. See the
 * module note for why this can't reuse `expandedMetricFields`. */
export function bondExpandedItems(
	columns: DataTableColumn<ConvertibleBondRowData>[],
	row: ConvertibleBondRowData
): StatGridItem[] {
	return columns
		.filter((col) => col.key !== CODE_COLUMN.key)
		.map((col) => ({
			label: col.label,
			value: col.render ? col.render(row) : "—",
		}));
}
