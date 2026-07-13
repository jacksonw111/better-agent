import type { DataTableColumn } from "./data-table-types";
import type { BlockTradeRowData } from "./finance-schemas-fe15";
import { formatCompact, formatDate, formatNum } from "./format";
import { ChangePct } from "./primitives";

// Phase 1 Batch B2 — column config for `block_trades` (design doc §9),
// ported field-for-field from the pre-DataTable block-trades-table.tsx's
// FinTable columns. `premiumPct` keeps the shared 红涨绿跌 `ChangePct`
// coloring: 溢价 (premium, positive) red, 折价 (discount, negative) green.
// `dealVolume` exists on BlockTradeRowSchema but was never rendered by that
// component, so it stays out here too. No `filters`: the payload carries no
// enumerable 买卖方向/营业部 discriminator — `buyer`/`seller` are free-text
// org names, not a fixed category set — so spec §9's "filters ... if the
// current component distinguishes it" resolves to no filter for this tool.

const TRADE_DATE_COLUMN: DataTableColumn<BlockTradeRowData> = {
	key: "tradeDate",
	label: "日期",
	render: (row) => formatDate(row.tradeDate),
};

const NAME_COLUMN: DataTableColumn<BlockTradeRowData> = {
	key: "name",
	label: "名称",
	render: (row) => row.name || row.code || "—",
};

const DEAL_PRICE_COLUMN: DataTableColumn<BlockTradeRowData> = {
	align: "right",
	key: "dealPrice",
	label: "成交价",
	render: (row) => formatNum(row.dealPrice),
	value: (row) => row.dealPrice,
};

const PREMIUM_PCT_COLUMN: DataTableColumn<BlockTradeRowData> = {
	align: "right",
	key: "premiumPct",
	label: "溢价率",
	render: (row) => <ChangePct value={row.premiumPct} />,
	value: (row) => row.premiumPct,
};

const DEAL_AMOUNT_COLUMN: DataTableColumn<BlockTradeRowData> = {
	align: "right",
	isMetric: true,
	key: "dealAmount",
	label: "成交额",
	render: (row) => formatCompact(row.dealAmount, { cny: true }),
	value: (row) => row.dealAmount,
};

const BUYER_COLUMN: DataTableColumn<BlockTradeRowData> = {
	key: "buyer",
	label: "买方",
	render: (row) => (
		<span className="line-clamp-1 max-w-48" title={row.buyer}>
			{row.buyer || "—"}
		</span>
	),
};

const SELLER_COLUMN: DataTableColumn<BlockTradeRowData> = {
	key: "seller",
	label: "卖方",
	render: (row) => (
		<span className="line-clamp-1 max-w-48" title={row.seller}>
			{row.seller || "—"}
		</span>
	),
};

/** `tradeDate` (categoryKey) plus every column the pre-DataTable component
 * rendered — only `dealAmount` is `isMetric`: a trend of block-trade
 * transaction size over dates is a meaningful bar series (spec §9 "MAY be
 * isMetric"), while `dealPrice`/`premiumPct` stay sortable-only since a
 * cross-trade price/premium trend mixes different underlying stocks and
 * doesn't read as one series. */
export function blockTradeColumns(): DataTableColumn<BlockTradeRowData>[] {
	return [
		TRADE_DATE_COLUMN,
		NAME_COLUMN,
		DEAL_PRICE_COLUMN,
		PREMIUM_PCT_COLUMN,
		DEAL_AMOUNT_COLUMN,
		BUYER_COLUMN,
		SELLER_COLUMN,
	];
}
