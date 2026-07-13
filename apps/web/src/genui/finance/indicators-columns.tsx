import type { ReactNode } from "react";
import type { DataTableColumn } from "./data-table-types";
import type { IndicatorRowData } from "./finance-schemas";
import { formatCompact, formatDate, formatNum, formatRatio } from "./format";
import { ChangePct } from "./primitives";

// Phase 1 Batch B1 — column config for `financial_indicators` (design doc
// §9), ported field-for-field from the pre-DataTable indicators-table.tsx's
// FinTable columns (revenue/revenueYoy/netProfit/netProfitYoy/grossMargin/
// netMargin/roe/debtRatio/eps/opCashPerShare) — `bps` and `roeDeducted` exist
// on IndicatorRowSchema but were never rendered by that component, so they
// stay out here too.

type NumericKey = Exclude<keyof IndicatorRowData, "reportDate" | "reportName">;

interface FieldSpec {
	key: NumericKey;
	label: string;
	render: (row: IndicatorRowData) => ReactNode;
}

const INDICATOR_FIELDS: FieldSpec[] = [
	{
		key: "revenue",
		label: "营收",
		render: (row) => formatCompact(row.revenue),
	},
	{
		key: "revenueYoy",
		label: "营收同比",
		render: (row) => <ChangePct value={row.revenueYoy} />,
	},
	{
		key: "netProfit",
		label: "归母净利",
		render: (row) => formatCompact(row.netProfit),
	},
	{
		key: "netProfitYoy",
		label: "净利同比",
		render: (row) => <ChangePct value={row.netProfitYoy} />,
	},
	{
		key: "grossMargin",
		label: "毛利率",
		render: (row) => formatRatio(row.grossMargin),
	},
	{
		key: "netMargin",
		label: "净利率",
		render: (row) => formatRatio(row.netMargin),
	},
	{ key: "roe", label: "ROE", render: (row) => formatRatio(row.roe) },
	{
		key: "debtRatio",
		label: "资产负债率",
		render: (row) => formatRatio(row.debtRatio),
	},
	{ key: "eps", label: "EPS", render: (row) => formatNum(row.eps) },
	{
		key: "opCashPerShare",
		label: "每股现金流",
		render: (row) => formatNum(row.opCashPerShare),
	},
];

/** The categoryKey / sticky-left column. Displays `reportName` (e.g. "2023年
 * 报") when the payload carries one, falling back to the formatted
 * `reportDate` — mirrors the pre-DataTable component's label logic exactly. */
const REPORT_COLUMN: DataTableColumn<IndicatorRowData> = {
	key: "reportDate",
	label: "报告期",
	render: (row) => row.reportName || formatDate(row.reportDate),
};

function toColumn(field: FieldSpec): DataTableColumn<IndicatorRowData> {
	return {
		align: "right",
		isMetric: true,
		key: field.key,
		label: field.label,
		render: field.render,
		value: (row) => row[field.key],
	};
}

/** `reportDate` (categoryKey) plus every ratio/amount metric column, each
 * plottable/sortable via its `value` accessor (§3). */
export function indicatorColumns(): DataTableColumn<IndicatorRowData>[] {
	return [REPORT_COLUMN, ...INDICATOR_FIELDS.map(toColumn)];
}
