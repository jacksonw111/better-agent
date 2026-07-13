import type { DataTableColumn } from "./data-table-types";
import type { DividendRowData } from "./finance-schemas";
import { formatCompact, formatDate } from "./format";

// Phase 1 Batch B1 — column config for `dividends` (design doc §9), ported
// field-for-field from the pre-DataTable dividends-table.tsx's FinTable
// columns. `bonusRatioTransfer`/`bonusRatioDividend` exist on
// DividendRowSchema but were never rendered by that component (they're
// per-10-share ratios embedded in `plan`'s free-text description already),
// so they stay out here too.

const REPORT_DATE_COLUMN: DataTableColumn<DividendRowData> = {
	key: "reportDate",
	label: "报告期",
	render: (row) => formatDate(row.reportDate),
};

const PLAN_COLUMN: DataTableColumn<DividendRowData> = {
	key: "plan",
	label: "方案",
	render: (row) => row.plan || "—",
};

const PRETAX_DIVIDEND_COLUMN: DataTableColumn<DividendRowData> = {
	align: "right",
	isMetric: true,
	key: "pretaxDividendRmb",
	label: "税前派息",
	render: (row) => formatCompact(row.pretaxDividendRmb, { cny: true }),
	value: (row) => row.pretaxDividendRmb,
};

const RECORD_DATE_COLUMN: DataTableColumn<DividendRowData> = {
	key: "recordDate",
	label: "股权登记日",
	render: (row) => formatDate(row.recordDate),
};

const EX_DIVIDEND_DATE_COLUMN: DataTableColumn<DividendRowData> = {
	key: "exDividendDate",
	label: "除权除息日",
	render: (row) => formatDate(row.exDividendDate),
};

const PROGRESS_COLUMN: DataTableColumn<DividendRowData> = {
	key: "progress",
	label: "进度",
	render: (row) => row.progress || "—",
};

/** `reportDate` (categoryKey) plus every column the pre-DataTable component
 * rendered — only `pretaxDividendRmb` is numeric/plottable (§3). */
export function dividendColumns(): DataTableColumn<DividendRowData>[] {
	return [
		REPORT_DATE_COLUMN,
		PLAN_COLUMN,
		PRETAX_DIVIDEND_COLUMN,
		RECORD_DATE_COLUMN,
		EX_DIVIDEND_DATE_COLUMN,
		PROGRESS_COLUMN,
	];
}
