import { Badge } from "../components/badge";
import type { DataTableColumn } from "./data-table-types";
import type { IpoRowData } from "./finance-schemas-fe13";
import { formatCompact, formatDate, formatNum } from "./format";
import type { StatGridItem } from "./primitives";

// Phase 1 Batch B4 — column config for `ipo` (design doc §9), ported
// field-for-field from the pre-DataTable ipo-table.tsx's FinTable columns.
// `applyDate` (申购日, the date the current component already sorts
// newest-first by) is the categoryKey. IpoRowSchema has no 募资额
// (total-funds-raised) field — `issuePrice` is a per-share price and
// `applyUpper` is an online-subscription share-count ceiling
// (ONLINE_APPLY_UPPER), neither a money-size trend worth plotting — so,
// unlike lockup/insider's `isMetric` money column, none of `issuePrice`/
// `applyUpper`/`afterPe`/`industryPe` is `isMetric` here (spec §9's "MAY be
// isMetric" judgment resolves to no Pivot chart; only `value` for sort).
// `market` is a free `z.string()` (not a schema-enforced enum) and, unlike
// earnings_preannounce's `type`, no existing component treats it as a fixed
// category set, so — per spec §9's "no filter unless the schema has a
// discrete status/board enum" — no `filters` either. No `isMetric` means
// `metric-expand.ts`'s `expandedMetricFields` would return nothing, so
// `ipoExpandedItems` below builds the row-detail expand directly from every
// non-category column's own `render`, mirroring
// `top-holders-columns.tsx`'s `holderExpandedItems`.

const NAME_COLUMN: DataTableColumn<IpoRowData> = {
	key: "name",
	label: "名称",
	render: (row) => row.name || row.code || "—",
};

const APPLY_CODE_COLUMN: DataTableColumn<IpoRowData> = {
	key: "applyCode",
	label: "申购代码",
	render: (row) => row.applyCode || "—",
};

const APPLY_DATE_COLUMN: DataTableColumn<IpoRowData> = {
	key: "applyDate",
	label: "申购日",
	render: (row) => formatDate(row.applyDate),
};

const LISTING_DATE_COLUMN: DataTableColumn<IpoRowData> = {
	key: "listingDate",
	label: "上市日",
	render: (row) => formatDate(row.listingDate),
};

const MARKET_COLUMN: DataTableColumn<IpoRowData> = {
	key: "market",
	label: "板块",
	render: (row) =>
		row.market ? <Badge variant="outline">{row.market}</Badge> : "—",
};

const ISSUE_PRICE_COLUMN: DataTableColumn<IpoRowData> = {
	align: "right",
	key: "issuePrice",
	label: "发行价",
	render: (row) => formatNum(row.issuePrice),
	value: (row) => row.issuePrice,
};

const APPLY_UPPER_COLUMN: DataTableColumn<IpoRowData> = {
	align: "right",
	key: "applyUpper",
	label: "申购上限",
	render: (row) => formatCompact(row.applyUpper),
	value: (row) => row.applyUpper,
};

const AFTER_PE_COLUMN: DataTableColumn<IpoRowData> = {
	align: "right",
	key: "afterPe",
	label: "发行PE",
	render: (row) => formatNum(row.afterPe),
	value: (row) => row.afterPe,
};

const INDUSTRY_PE_COLUMN: DataTableColumn<IpoRowData> = {
	align: "right",
	key: "industryPe",
	label: "行业PE",
	render: (row) => formatNum(row.industryPe),
	value: (row) => row.industryPe,
};

/** `applyDate` (categoryKey) plus every column the pre-DataTable component
 * rendered — see the module note above for why none is `isMetric`. */
export function ipoColumns(): DataTableColumn<IpoRowData>[] {
	return [
		NAME_COLUMN,
		APPLY_CODE_COLUMN,
		APPLY_DATE_COLUMN,
		LISTING_DATE_COLUMN,
		MARKET_COLUMN,
		ISSUE_PRICE_COLUMN,
		APPLY_UPPER_COLUMN,
		AFTER_PE_COLUMN,
		INDUSTRY_PE_COLUMN,
	];
}

/** Row-detail expand for a single IPO — every non-category column's own
 * rendered cell, so the expand always matches what the grid shows. See the
 * module note for why this can't reuse `expandedMetricFields`. */
export function ipoExpandedItems(
	columns: DataTableColumn<IpoRowData>[],
	row: IpoRowData
): StatGridItem[] {
	return columns
		.filter((col) => col.key !== APPLY_DATE_COLUMN.key)
		.map((col) => ({
			label: col.label,
			value: col.render ? col.render(row) : "—",
		}));
}
