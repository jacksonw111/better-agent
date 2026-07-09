import type { IndicatorRowData } from "./finance-schemas";
import { formatCompact, formatDate, formatNum, formatRatio } from "./format";
import { ChangePct, FinTable, type FinTableColumn } from "./primitives";

const INDICATOR_COLUMNS: FinTableColumn<IndicatorRowData>[] = [
	{
		key: "reportName",
		label: "报告期",
		render: (row) => row.reportName || formatDate(row.reportDate),
	},
	{
		align: "right",
		key: "revenue",
		label: "营收",
		render: (row) => formatCompact(row.revenue),
	},
	{
		align: "right",
		key: "revenueYoy",
		label: "营收同比",
		render: (row) => <ChangePct value={row.revenueYoy} />,
	},
	{
		align: "right",
		key: "netProfit",
		label: "归母净利",
		render: (row) => formatCompact(row.netProfit),
	},
	{
		align: "right",
		key: "netProfitYoy",
		label: "净利同比",
		render: (row) => <ChangePct value={row.netProfitYoy} />,
	},
	{
		align: "right",
		key: "grossMargin",
		label: "毛利率",
		render: (row) => formatRatio(row.grossMargin),
	},
	{
		align: "right",
		key: "netMargin",
		label: "净利率",
		render: (row) => formatRatio(row.netMargin),
	},
	{
		align: "right",
		key: "roe",
		label: "ROE",
		render: (row) => formatRatio(row.roe),
	},
	{
		align: "right",
		key: "debtRatio",
		label: "资产负债率",
		render: (row) => formatRatio(row.debtRatio),
	},
	{
		align: "right",
		key: "eps",
		label: "EPS",
		render: (row) => formatNum(row.eps),
	},
	{
		align: "right",
		key: "opCashPerShare",
		label: "每股现金流",
		render: (row) => formatNum(row.opCashPerShare),
	},
];

/** finance_financial_indicators → one dense FinTable row per reporting
 * period, newest first (the tool already returns rows in that order). */
export function IndicatorsTable({ data }: { data: IndicatorRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<FinTable
			columns={INDICATOR_COLUMNS}
			getRowKey={(row) => row.reportDate}
			rows={data}
		/>
	);
}
