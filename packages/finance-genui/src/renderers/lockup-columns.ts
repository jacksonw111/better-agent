import type { DataTableColumn } from "./data-table-types";
import type { LockupRowData } from "./finance-schemas-fe13";
import { formatCompact, formatDate, formatNum } from "./format";

// Phase 1 Batch B3 — column config for `lockup` (design doc §9), ported
// field-for-field from the pre-DataTable lockup-table.tsx's FinTable columns.
// `freeRatio` comes straight through from EastMoney's RPT_LIFT_STAGE report
// as-is (its scale isn't pinned down — could already be a %-scale number or a
// small decimal) so this renders it with a literal "%" suffix rather than
// guessing at a conversion, same caveat as the pre-DataTable component. Only
// `liftMarketCap` is `isMetric`: a trend of upcoming unlock value over dates
// is a meaningful bar series (spec §9 "MAY be isMetric"), while
// `freeShares`/`freeRatio` stay sortable-only. No `filters`: LockupRowSchema
// carries no time-window discriminator, so spec §9's "filters ... if the
// current component/spec distinguishes it" resolves to no filter for this
// tool.

const FREE_DATE_COLUMN: DataTableColumn<LockupRowData> = {
	key: "freeDate",
	label: "解禁日",
	render: (row) => formatDate(row.freeDate),
};

const NAME_COLUMN: DataTableColumn<LockupRowData> = {
	key: "name",
	label: "名称",
	render: (row) => row.name || row.code || "—",
};

const FREE_SHARES_COLUMN: DataTableColumn<LockupRowData> = {
	align: "right",
	key: "freeShares",
	label: "解禁数量",
	render: (row) => formatCompact(row.freeShares),
	value: (row) => row.freeShares,
};

const FREE_RATIO_COLUMN: DataTableColumn<LockupRowData> = {
	align: "right",
	key: "freeRatio",
	label: "占总股本%",
	render: (row) =>
		row.freeRatio === null ? "—" : `${formatNum(row.freeRatio)}%`,
	value: (row) => row.freeRatio,
};

const LIFT_MARKET_CAP_COLUMN: DataTableColumn<LockupRowData> = {
	align: "right",
	isMetric: true,
	key: "liftMarketCap",
	label: "解禁市值",
	render: (row) => formatCompact(row.liftMarketCap, { cny: true }),
	value: (row) => row.liftMarketCap,
};

const TYPE_COLUMN: DataTableColumn<LockupRowData> = {
	key: "type",
	label: "类型",
	render: (row) => row.type || "—",
};

/** `freeDate` (categoryKey) plus every column the pre-DataTable component
 * rendered — only `liftMarketCap` is `isMetric`; see the module note above. */
export function lockupColumns(): DataTableColumn<LockupRowData>[] {
	return [
		FREE_DATE_COLUMN,
		NAME_COLUMN,
		FREE_SHARES_COLUMN,
		FREE_RATIO_COLUMN,
		LIFT_MARKET_CAP_COLUMN,
		TYPE_COLUMN,
	];
}
