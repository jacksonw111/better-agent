import type { StatementRowData } from "./finance-schemas";
import { formatCompact, formatDate, formatRatio } from "./format";
import { FinTable, type FinTableColumn } from "./primitives";

type StatementKind = "income" | "balance" | "cashflow";

const INCOME_KEYS = [
	"revenue",
	"operatingCost",
	"operatingProfit",
	"totalProfit",
	"netProfit",
	"netProfitDeducted",
] as const;

const BALANCE_KEYS = [
	"totalAssets",
	"totalLiabilities",
	"totalEquity",
	"cash",
	"debtRatio",
] as const;

const CASHFLOW_KEYS = [
	"operatingCashflow",
	"investingCashflow",
	"financingCashflow",
	"netCashChange",
] as const;

function countNonNull(
	rows: StatementRowData[],
	keys: readonly (keyof StatementRowData)[]
): number {
	let count = 0;
	for (const row of rows) {
		for (const key of keys) {
			if (row[key] !== null) {
				count += 1;
			}
		}
	}
	return count;
}

/** A StatementRow only ever carries the numeric keys for its own
 * statement=income|balance|cashflow request (see StatementRow's index
 * signature) — every other field is nullable in the schema, so the actual
 * shape is detected by which key group has data, not by a discriminator
 * field. Ties fall back to "income", the default statement. */
function detectStatementKind(rows: StatementRowData[]): StatementKind {
	const balanceCount = countNonNull(rows, BALANCE_KEYS);
	const cashflowCount = countNonNull(rows, CASHFLOW_KEYS);
	const incomeCount = countNonNull(rows, INCOME_KEYS);
	if (balanceCount > incomeCount && balanceCount > cashflowCount) {
		return "balance";
	}
	if (cashflowCount > incomeCount && cashflowCount > balanceCount) {
		return "cashflow";
	}
	return "income";
}

const REPORT_DATE_COLUMN: FinTableColumn<StatementRowData> = {
	key: "reportDate",
	label: "报告期",
	render: (row) => formatDate(row.reportDate),
};

const STATEMENT_COLUMNS: Record<
	StatementKind,
	FinTableColumn<StatementRowData>[]
> = {
	balance: [
		REPORT_DATE_COLUMN,
		{
			align: "right",
			key: "totalAssets",
			label: "总资产",
			render: (row) => formatCompact(row.totalAssets),
		},
		{
			align: "right",
			key: "totalLiabilities",
			label: "总负债",
			render: (row) => formatCompact(row.totalLiabilities),
		},
		{
			align: "right",
			key: "totalEquity",
			label: "股东权益",
			render: (row) => formatCompact(row.totalEquity),
		},
		{
			align: "right",
			key: "cash",
			label: "货币资金",
			render: (row) => formatCompact(row.cash),
		},
		{
			align: "right",
			key: "debtRatio",
			label: "资产负债率",
			render: (row) => formatRatio(row.debtRatio),
		},
	],
	cashflow: [
		REPORT_DATE_COLUMN,
		{
			align: "right",
			key: "operatingCashflow",
			label: "经营活动现金流",
			render: (row) => formatCompact(row.operatingCashflow),
		},
		{
			align: "right",
			key: "investingCashflow",
			label: "投资活动现金流",
			render: (row) => formatCompact(row.investingCashflow),
		},
		{
			align: "right",
			key: "financingCashflow",
			label: "筹资活动现金流",
			render: (row) => formatCompact(row.financingCashflow),
		},
		{
			align: "right",
			key: "netCashChange",
			label: "现金净增加额",
			render: (row) => formatCompact(row.netCashChange),
		},
	],
	income: [
		REPORT_DATE_COLUMN,
		{
			align: "right",
			key: "revenue",
			label: "营业收入",
			render: (row) => formatCompact(row.revenue),
		},
		{
			align: "right",
			key: "operatingCost",
			label: "营业成本",
			render: (row) => formatCompact(row.operatingCost),
		},
		{
			align: "right",
			key: "operatingProfit",
			label: "营业利润",
			render: (row) => formatCompact(row.operatingProfit),
		},
		{
			align: "right",
			key: "totalProfit",
			label: "利润总额",
			render: (row) => formatCompact(row.totalProfit),
		},
		{
			align: "right",
			key: "netProfit",
			label: "归母净利润",
			render: (row) => formatCompact(row.netProfit),
		},
		{
			align: "right",
			key: "netProfitDeducted",
			label: "扣非净利润",
			render: (row) => formatCompact(row.netProfitDeducted),
		},
	],
};

/** finance_financial_statements → one FinTable row per reporting period,
 * newest first (the tool already returns rows in that order). Column set is
 * picked from the detected income/balance/cashflow kind since the result
 * doesn't carry an explicit statement-type field. */
export function StatementsTable({ data }: { data: StatementRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const columns = STATEMENT_COLUMNS[detectStatementKind(data)];
	return (
		<FinTable
			columns={columns}
			getRowKey={(row) => row.reportDate}
			rows={data}
		/>
	);
}
