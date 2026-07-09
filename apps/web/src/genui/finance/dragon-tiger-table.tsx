import type { DragonTigerRowData } from "./finance-schemas";
import { formatCompact, formatDate, formatNum, formatRatio } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const DRAGON_TIGER_COLUMNS: FinTableColumn<DragonTigerRowData>[] = [
	{
		key: "name",
		label: "名称",
		render: (row) => row.name || row.code || "—",
	},
	{
		key: "code",
		label: "代码",
		render: (row) => row.code || "—",
	},
	{
		align: "right",
		key: "close",
		label: "收盘",
		render: (row) => formatNum(row.close),
	},
	{
		align: "right",
		key: "changePct",
		label: "涨跌幅",
		render: (row) => <ChangePct value={row.changePct} />,
	},
	{
		align: "right",
		key: "turnoverRate",
		label: "换手率",
		render: (row) => formatRatio(row.turnoverRate),
	},
	{
		align: "right",
		key: "billboardAmount",
		label: "龙虎榜成交额",
		render: (row) => formatCompact(row.billboardAmount, { cny: true }),
	},
	{
		key: "reason",
		label: "上榜原因",
		render: (row) => (
			<span className="line-clamp-2 max-w-56" title={row.reason}>
				{row.reason || "—"}
			</span>
		),
	},
];

/** finance_dragon_tiger → 龙虎榜, newest `tradeDate` first (the tool already
 * returns rows in that order). Subtitle shows the trade date of the first
 * row, which the source query is always scoped to a single date. */
export function DragonTigerTable({ data }: { data: DragonTigerRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell subtitle={formatDate(data[0]?.tradeDate)} title="龙虎榜">
			<FinTable
				columns={DRAGON_TIGER_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
