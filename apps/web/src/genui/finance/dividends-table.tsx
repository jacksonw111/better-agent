import type { DividendRowData } from "./finance-schemas";
import { formatCompact, formatDate } from "./format";
import { FinTable, type FinTableColumn } from "./primitives";

const DIVIDEND_COLUMNS: FinTableColumn<DividendRowData>[] = [
	{
		key: "reportDate",
		label: "报告期",
		render: (row) => formatDate(row.reportDate),
	},
	{
		key: "plan",
		label: "方案",
		render: (row) => row.plan || "—",
	},
	{
		align: "right",
		key: "pretaxDividendRmb",
		label: "税前派息",
		render: (row) => formatCompact(row.pretaxDividendRmb, { cny: true }),
	},
	{
		key: "recordDate",
		label: "股权登记日",
		render: (row) => formatDate(row.recordDate),
	},
	{
		key: "exDividendDate",
		label: "除权除息日",
		render: (row) => formatDate(row.exDividendDate),
	},
	{
		key: "progress",
		label: "进度",
		render: (row) => row.progress || "—",
	},
];

/** finance_dividends → 分红方案, newest `reportDate` first (the tool already
 * returns rows in that order). */
export function DividendsTable({ data }: { data: DividendRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<FinTable
			columns={DIVIDEND_COLUMNS}
			getRowKey={(row, index) => `${row.reportDate}-${index}`}
			rows={data}
		/>
	);
}
