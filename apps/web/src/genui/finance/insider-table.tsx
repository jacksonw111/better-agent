import { Badge } from "@better-agent/ui/components/badge";
import type { InsiderRowData } from "./finance-schemas-fe15";
import { formatCompact, formatDate, formatNum } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

// finance_insider_trades → 高管/股东增减持. Direction is derived from the sign
// of `changeShares` rather than `holdType` (source labels vary), following
// 红涨绿跌: 减持 (sell-down, negative) green, 增持 (buy-up, non-negative) red.

const REDUCE_STYLE = { borderColor: "#16a34a40", color: "#16a34a" };
const INCREASE_STYLE = { borderColor: "#ef444440", color: "#ef4444" };

function DirectionBadge({ changeShares }: { changeShares: number | null }) {
	const isReduce = (changeShares ?? 0) < 0;
	return (
		<Badge style={isReduce ? REDUCE_STYLE : INCREASE_STYLE} variant="outline">
			{isReduce ? "减持" : "增持"}
		</Badge>
	);
}

const INSIDER_COLUMNS: FinTableColumn<InsiderRowData>[] = [
	{
		key: "changeDate",
		label: "日期",
		render: (row) => formatDate(row.changeDate),
	},
	{ key: "name", label: "名称", render: (row) => row.name || row.code || "—" },
	{ key: "person", label: "变动人", render: (row) => row.person || "—" },
	{
		key: "position",
		label: "职务",
		render: (row) => (
			<span className="line-clamp-1 max-w-32" title={row.position}>
				{row.position || "—"}
			</span>
		),
	},
	{
		key: "direction",
		label: "方向",
		render: (row) => <DirectionBadge changeShares={row.changeShares} />,
	},
	{
		align: "right",
		key: "changeShares",
		label: "变动股数",
		render: (row) =>
			row.changeShares === null
				? "—"
				: formatCompact(Math.abs(row.changeShares)),
	},
	{
		align: "right",
		key: "avgPrice",
		label: "均价",
		render: (row) => formatNum(row.avgPrice),
	},
	{
		align: "right",
		key: "changeAmount",
		label: "变动金额",
		render: (row) => formatCompact(row.changeAmount, { cny: true }),
	},
	{
		key: "reason",
		label: "原因",
		render: (row) => (
			<span className="line-clamp-2 max-w-56" title={row.reason}>
				{row.reason || "—"}
			</span>
		),
	},
];

/** finance_insider_trades → 高管/股东增减持, newest `changeDate` first (the
 * tool already returns rows in that order). */
export function InsiderTable({ data }: { data: InsiderRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="高管/股东增减持">
			<FinTable
				columns={INSIDER_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${row.changeDate}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
