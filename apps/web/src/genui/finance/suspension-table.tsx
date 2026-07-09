import type { SuspensionRowData } from "./finance-schemas-fe15";
import { formatDate } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const SUSPENSION_COLUMNS: FinTableColumn<SuspensionRowData>[] = [
	{ key: "name", label: "名称", render: (row) => row.name || row.code || "—" },
	{ key: "code", label: "代码", render: (row) => row.code || "—" },
	{
		key: "suspendStart",
		label: "停牌起",
		render: (row) => formatDate(row.suspendStart),
	},
	{
		key: "suspendEnd",
		label: "复牌",
		render: (row) => (row.suspendEnd ? formatDate(row.suspendEnd) : "—"),
	},
	{
		key: "expire",
		label: "期限",
		render: (row) => row.expire || "—",
	},
	{
		key: "reason",
		label: "原因",
		render: (row) => (
			<span className="line-clamp-2 max-w-56" title={row.reason ?? undefined}>
				{row.reason || "—"}
			</span>
		),
	},
	{
		key: "predictResume",
		label: "预计复牌",
		render: (row) => (row.predictResume ? formatDate(row.predictResume) : "—"),
	},
];

/** finance_suspension → 停复牌, newest `suspendStart` first (the tool already
 * returns rows in that order). */
export function SuspensionTable({ data }: { data: SuspensionRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="停复牌">
			<FinTable
				columns={SUSPENSION_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${row.suspendStart}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
