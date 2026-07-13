import type { DataTableColumn } from "./data-table-types";
import type { StatementRowData } from "./finance-schemas";
import { formatCompact, formatDate, formatRatio } from "./format";

// Phase 1 Task 2 — column config for the `financial_statements` flagship
// DataTable (design doc §8.1). `StatementRowData` only ever carries the
// numeric fields for its own statement=income|balance|cashflow request (every
// other field is nullable, see finance-schemas.ts); `detectStatementKind`
// below is preserved from the pre-DataTable renderer since the payload itself
// carries no explicit statement-type discriminator.

export type StatementKind = "income" | "balance" | "cashflow";
type NumericKey = Exclude<keyof StatementRowData, "reportDate">;

interface FieldSpec {
	format?: (n: number | null) => string;
	key: NumericKey;
	label: string;
}

const INCOME_FIELDS: FieldSpec[] = [
	{ key: "revenue", label: "营业收入" },
	{ key: "operatingCost", label: "营业成本" },
	{ key: "operatingProfit", label: "营业利润" },
	{ key: "totalProfit", label: "利润总额" },
	{ key: "netProfit", label: "归母净利润" },
	{ key: "netProfitDeducted", label: "扣非净利润" },
];

const BALANCE_FIELDS: FieldSpec[] = [
	{ key: "totalAssets", label: "总资产" },
	{ key: "totalLiabilities", label: "总负债" },
	{ key: "totalEquity", label: "股东权益" },
	{ key: "cash", label: "货币资金" },
	{ format: formatRatio, key: "debtRatio", label: "资产负债率" },
];

const CASHFLOW_FIELDS: FieldSpec[] = [
	{ key: "operatingCashflow", label: "经营活动现金流" },
	{ key: "investingCashflow", label: "投资活动现金流" },
	{ key: "financingCashflow", label: "筹资活动现金流" },
	{ key: "netCashChange", label: "现金净增加额" },
];

const FIELDS_BY_KIND: Record<StatementKind, FieldSpec[]> = {
	balance: BALANCE_FIELDS,
	cashflow: CASHFLOW_FIELDS,
	income: INCOME_FIELDS,
};

export const STATEMENT_TITLES: Record<StatementKind, string> = {
	balance: "资产负债表",
	cashflow: "现金流量表",
	income: "利润表",
};

function countNonNull(rows: StatementRowData[], fields: FieldSpec[]): number {
	let count = 0;
	for (const row of rows) {
		for (const field of fields) {
			if (row[field.key] !== null) {
				count += 1;
			}
		}
	}
	return count;
}

/** Ties fall back to "income", the default statement — see the module note
 * above for why this can't just read a discriminator field. */
export function detectStatementKind(rows: StatementRowData[]): StatementKind {
	const balance = countNonNull(rows, BALANCE_FIELDS);
	const cashflow = countNonNull(rows, CASHFLOW_FIELDS);
	const income = countNonNull(rows, INCOME_FIELDS);
	if (balance > income && balance > cashflow) {
		return "balance";
	}
	if (cashflow > income && cashflow > balance) {
		return "cashflow";
	}
	return "income";
}

const REPORT_DATE_COLUMN: DataTableColumn<StatementRowData> = {
	key: "reportDate",
	label: "报告期",
	render: (row) => formatDate(row.reportDate),
};

function toColumn(field: FieldSpec): DataTableColumn<StatementRowData> {
	const format = field.format ?? formatCompact;
	return {
		align: "right",
		isMetric: true,
		key: field.key,
		label: field.label,
		render: (row) => format(row[field.key]),
		value: (row) => row[field.key],
	};
}

/** The kind-appropriate column set: `reportDate` (the categoryKey/sticky-left
 * label column) plus every metric column for that statement kind, each a
 * plottable/sortable Series (§3) via its `value` accessor. */
export function statementColumns(
	kind: StatementKind
): DataTableColumn<StatementRowData>[] {
	return [REPORT_DATE_COLUMN, ...FIELDS_BY_KIND[kind].map(toColumn)];
}
