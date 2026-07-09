import { Badge } from "@better-agent/ui/components/badge";
import type { IpoRowData } from "./finance-schemas-fe13";
import { formatCompact, formatDate, formatNum } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const IPO_COLUMNS: FinTableColumn<IpoRowData>[] = [
	{ key: "name", label: "名称", render: (row) => row.name || row.code || "—" },
	{
		key: "applyCode",
		label: "申购代码",
		render: (row) => row.applyCode || "—",
	},
	{
		key: "applyDate",
		label: "申购日",
		render: (row) => formatDate(row.applyDate),
	},
	{
		key: "listingDate",
		label: "上市日",
		render: (row) => formatDate(row.listingDate),
	},
	{
		key: "market",
		label: "板块",
		render: (row) =>
			row.market ? <Badge variant="outline">{row.market}</Badge> : "—",
	},
	{
		align: "right",
		key: "issuePrice",
		label: "发行价",
		render: (row) => formatNum(row.issuePrice),
	},
	{
		align: "right",
		key: "applyUpper",
		label: "申购上限",
		render: (row) => formatCompact(row.applyUpper),
	},
	{
		align: "right",
		key: "afterPe",
		label: "发行PE",
		render: (row) => formatNum(row.afterPe),
	},
	{
		align: "right",
		key: "industryPe",
		label: "行业PE",
		render: (row) => formatNum(row.industryPe),
	},
];

/** finance_ipo → 新股申购日历, newest `applyDate` first (the tool already
 * returns rows in that order). */
export function IpoTable({ data }: { data: IpoRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="新股申购">
			<FinTable
				columns={IPO_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${row.applyDate}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
