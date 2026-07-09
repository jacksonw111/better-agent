import { Badge } from "@better-agent/ui/components/badge";
import type { ConvertibleBondRowData } from "./finance-schemas-fe13";
import { formatCompact, formatDate } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const CONVERTIBLE_BOND_COLUMNS: FinTableColumn<ConvertibleBondRowData>[] = [
	{ key: "code", label: "债券代码", render: (row) => row.code || "—" },
	{ key: "name", label: "债券名称", render: (row) => row.name || "—" },
	{
		key: "stockCode",
		label: "正股代码",
		render: (row) => row.stockCode || "—",
	},
	{
		key: "rating",
		label: "评级",
		render: (row) =>
			row.rating ? <Badge variant="outline">{row.rating}</Badge> : "—",
	},
	{
		key: "listingDate",
		label: "上市日",
		render: (row) => formatDate(row.listingDate),
	},
	{
		key: "expireDate",
		label: "到期日",
		render: (row) => formatDate(row.expireDate),
	},
	{
		align: "right",
		key: "issueScale",
		label: "发行规模",
		render: (row) => formatCompact(row.issueScale, { cny: true }),
	},
];

/** finance_convertible_bonds → 可转债, newest `listingDate` first (the tool
 * already returns rows in that order). */
export function ConvertibleBondsTable({
	data,
}: {
	data: ConvertibleBondRowData[];
}) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="可转债">
			<FinTable
				columns={CONVERTIBLE_BOND_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
