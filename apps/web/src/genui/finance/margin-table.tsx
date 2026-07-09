import type { MarginRowData } from "./finance-schemas-fe11";
import { formatCompact, formatDate, formatRatio } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const MARGIN_COLUMNS: FinTableColumn<MarginRowData>[] = [
	{ key: "date", label: "日期", render: (row) => formatDate(row.date) },
	{
		align: "right",
		key: "financingBalance",
		label: "融资余额",
		render: (row) => formatCompact(row.financingBalance, { cny: true }),
	},
	{
		align: "right",
		key: "financingBuy",
		label: "融资买入额",
		render: (row) => formatCompact(row.financingBuy, { cny: true }),
	},
	{
		align: "right",
		key: "securitiesBalance",
		label: "融券余额",
		render: (row) => formatCompact(row.securitiesBalance, { cny: true }),
	},
	{
		align: "right",
		key: "totalBalance",
		label: "融资融券余额",
		render: (row) => formatCompact(row.totalBalance, { cny: true }),
	},
	{
		align: "right",
		key: "financingBalanceRatio",
		label: "融资余额占比",
		render: (row) => formatRatio(row.financingBalanceRatio),
	},
];

/** finance_margin → 融资融券, newest `date` first (the tool already returns
 * rows in that order). */
export function MarginTable({ data }: { data: MarginRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="融资融券">
			<FinTable
				columns={MARGIN_COLUMNS}
				getRowKey={(row, index) => `${row.date}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
