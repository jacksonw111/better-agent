import type { ForecastRowData } from "./finance-schemas-fe8";
import { formatCompact, formatNum } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const FORECAST_COLUMNS: FinTableColumn<ForecastRowData>[] = [
	{ key: "year", label: "年度", render: (row) => row.year || "—" },
	{
		align: "right",
		key: "eps",
		label: "EPS",
		render: (row) => formatNum(row.eps),
	},
	{
		align: "right",
		key: "pe",
		label: "PE",
		render: (row) => formatNum(row.pe),
	},
	{
		align: "right",
		key: "revenue",
		label: "营收",
		render: (row) =>
			row.revenue === null ? "—" : formatCompact(row.revenue, { cny: true }),
	},
];

/** finance_earnings_forecast → 盈利预测(一致预期), one row per fiscal year
 * (this FY / next / +2). The 营收 column only renders when at least one row
 * actually carries `revenue` — it's optional on ForecastRow. */
export function ForecastTable({ data }: { data: ForecastRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const hasRevenue = data.some((row) => row.revenue !== null);
	const columns = hasRevenue
		? FORECAST_COLUMNS
		: FORECAST_COLUMNS.filter((col) => col.key !== "revenue");
	return (
		<CardShell title="盈利预测(一致预期)">
			<FinTable
				columns={columns}
				getRowKey={(row, index) => `${row.year}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
