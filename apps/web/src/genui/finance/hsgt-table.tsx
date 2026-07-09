import type { HsgtRowData } from "./finance-schemas";
import { changeColor, formatCompact, formatDate } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

// EastMoney reports HSGT flow amounts in 万元 (ten-thousand-yuan units); scale
// up to raw yuan before handing to `formatCompact`, which auto-picks the
// 万/亿/万亿 suffix from the magnitude.
const WAN_TO_YUAN = 1e4;

function toYuan(wan: number | null): number | null {
	return wan === null ? null : wan * WAN_TO_YUAN;
}

const DIRECTION_LABEL: Record<HsgtRowData["direction"], string> = {
	north: "北向",
	south: "南向",
};

function NetFlowCell({ value }: { value: number | null }) {
	if (value === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	const yuan = toYuan(value);
	const color = changeColor(value);
	const sign = value > 0 ? "+" : "";
	return (
		<span style={color ? { color } : undefined}>
			{sign}
			{formatCompact(yuan, { cny: true })}
		</span>
	);
}

const HSGT_COLUMNS: FinTableColumn<HsgtRowData>[] = [
	{
		key: "tradeDate",
		label: "日期",
		render: (row) => formatDate(row.tradeDate),
	},
	{
		key: "channel",
		label: "通道",
		render: (row) => row.channel || "—",
	},
	{
		key: "direction",
		label: "方向",
		render: (row) => DIRECTION_LABEL[row.direction],
	},
	{
		align: "right",
		key: "netAmt",
		label: "净流入",
		render: (row) => <NetFlowCell value={row.netAmt} />,
	},
	{
		align: "right",
		key: "buyAmt",
		label: "买入额",
		render: (row) => formatCompact(toYuan(row.buyAmt), { cny: true }),
	},
	{
		align: "right",
		key: "sellAmt",
		label: "卖出额",
		render: (row) => formatCompact(toYuan(row.sellAmt), { cny: true }),
	},
	{
		key: "leadStock",
		label: "领涨股",
		render: (row) => row.leadStock ?? "—",
	},
];

/** finance_hsgt_flow → 沪深港通资金流 by channel, newest `tradeDate` first
 * (the tool already returns rows in that order). Northbound (沪股通/深股通)
 * net flow is null on every row since mainland exchanges stopped disclosing
 * it on 2024-08-19 — a note surfaces that instead of a bare dash reading as
 * missing data. */
export function HsgtTable({ data }: { data: HsgtRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const hasSuppressedNorth = data.some(
		(row) => row.direction === "north" && row.netAmt === null
	);
	return (
		<CardShell title="沪深港通资金流">
			<FinTable
				columns={HSGT_COLUMNS}
				getRowKey={(row, index) => `${row.tradeDate}-${row.channel}-${index}`}
				rows={data}
			/>
			{hasSuppressedNorth ? (
				<p className="text-muted-foreground text-xs">
					北向资金净流入自2024年8月19日起不再披露
				</p>
			) : null}
		</CardShell>
	);
}
