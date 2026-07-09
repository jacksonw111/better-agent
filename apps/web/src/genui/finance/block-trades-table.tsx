import type { BlockTradeRowData } from "./finance-schemas-fe15";
import { formatCompact, formatDate, formatNum } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const BLOCK_TRADE_COLUMNS: FinTableColumn<BlockTradeRowData>[] = [
	{
		key: "tradeDate",
		label: "日期",
		render: (row) => formatDate(row.tradeDate),
	},
	{ key: "name", label: "名称", render: (row) => row.name || row.code || "—" },
	{
		align: "right",
		key: "dealPrice",
		label: "成交价",
		render: (row) => formatNum(row.dealPrice),
	},
	{
		align: "right",
		key: "premiumPct",
		label: "溢价率",
		render: (row) => <ChangePct value={row.premiumPct} />,
	},
	{
		align: "right",
		key: "dealAmount",
		label: "成交额",
		render: (row) => formatCompact(row.dealAmount, { cny: true }),
	},
	{
		key: "buyer",
		label: "买方",
		render: (row) => (
			<span className="line-clamp-1 max-w-48" title={row.buyer}>
				{row.buyer || "—"}
			</span>
		),
	},
	{
		key: "seller",
		label: "卖方",
		render: (row) => (
			<span className="line-clamp-1 max-w-48" title={row.seller}>
				{row.seller || "—"}
			</span>
		),
	},
];

/** finance_block_trades → 大宗交易, newest `tradeDate` first (the tool
 * already returns rows in that order). `premiumPct` follows the shared
 * 红涨绿跌 `ChangePct` coloring: 溢价 (premium, positive) red, 折价
 * (discount, negative) green. */
export function BlockTradesTable({ data }: { data: BlockTradeRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="大宗交易">
			<FinTable
				columns={BLOCK_TRADE_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${row.tradeDate}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
