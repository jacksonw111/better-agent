import { Badge } from "@better-agent/ui/components/badge";
import type { DataTableColumn, DataTableFilter } from "./data-table-types";
import type { InsiderRowData } from "./finance-schemas-fe15";
import { formatCompact, formatDate, formatNum } from "./format";

// Phase 1 Batch B2 — column config for `insider_trades` (design doc §9),
// ported field-for-field from the pre-DataTable insider-table.tsx's FinTable
// columns (changeDate/name/person/position/direction/changeShares/avgPrice/
// changeAmount/reason) — `holdType`/`changeRatio`/`relatedExec` exist on
// InsiderRowSchema but were never rendered by that component, so they stay
// out here too. Direction is derived from the sign of `changeShares` rather
// than `holdType` (source labels vary), following 红涨绿跌: 减持 (sell-down,
// negative) green, 增持 (buy-up, non-negative) red — `DirectionBadge` and
// `INSIDER_FILTERS` below share that same derivation.

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

const CHANGE_DATE_COLUMN: DataTableColumn<InsiderRowData> = {
	key: "changeDate",
	label: "日期",
	render: (row) => formatDate(row.changeDate),
};

const NAME_COLUMN: DataTableColumn<InsiderRowData> = {
	key: "name",
	label: "名称",
	render: (row) => row.name || row.code || "—",
};

const PERSON_COLUMN: DataTableColumn<InsiderRowData> = {
	key: "person",
	label: "变动人",
	render: (row) => row.person || "—",
};

const POSITION_COLUMN: DataTableColumn<InsiderRowData> = {
	key: "position",
	label: "职务",
	render: (row) => (
		<span className="line-clamp-1 max-w-32" title={row.position}>
			{row.position || "—"}
		</span>
	),
};

const DIRECTION_COLUMN: DataTableColumn<InsiderRowData> = {
	key: "direction",
	label: "方向",
	render: (row) => <DirectionBadge changeShares={row.changeShares} />,
};

const CHANGE_SHARES_COLUMN: DataTableColumn<InsiderRowData> = {
	align: "right",
	key: "changeShares",
	label: "变动股数",
	render: (row) =>
		row.changeShares === null ? "—" : formatCompact(Math.abs(row.changeShares)),
	// Sorts by magnitude, matching the rendered (already-absolute) value —
	// not `isMetric`: the render discards sign, so a trend line of this
	// value alone would misread (see the module note in insider-table.tsx).
	value: (row) =>
		row.changeShares === null ? null : Math.abs(row.changeShares),
};

const AVG_PRICE_COLUMN: DataTableColumn<InsiderRowData> = {
	align: "right",
	key: "avgPrice",
	label: "均价",
	render: (row) => formatNum(row.avgPrice),
	value: (row) => row.avgPrice,
};

const CHANGE_AMOUNT_COLUMN: DataTableColumn<InsiderRowData> = {
	align: "right",
	isMetric: true,
	key: "changeAmount",
	label: "变动金额",
	render: (row) => formatCompact(row.changeAmount, { cny: true }),
	value: (row) => row.changeAmount,
};

const REASON_COLUMN: DataTableColumn<InsiderRowData> = {
	key: "reason",
	label: "原因",
	render: (row) => (
		<span className="line-clamp-2 max-w-56" title={row.reason}>
			{row.reason || "—"}
		</span>
	),
};

/** `changeDate` (categoryKey) plus every column the pre-DataTable component
 * rendered — only `changeAmount` is `isMetric`. */
export function insiderColumns(): DataTableColumn<InsiderRowData>[] {
	return [
		CHANGE_DATE_COLUMN,
		NAME_COLUMN,
		PERSON_COLUMN,
		POSITION_COLUMN,
		DIRECTION_COLUMN,
		CHANGE_SHARES_COLUMN,
		AVG_PRICE_COLUMN,
		CHANGE_AMOUNT_COLUMN,
		REASON_COLUMN,
	];
}

/** 增持/减持 single-select filter, mirroring `DirectionBadge`'s own
 * sign-of-`changeShares` derivation above. */
export const INSIDER_FILTERS: DataTableFilter<InsiderRowData>[] = [
	{
		id: "increase",
		label: "增持",
		predicate: (row) => (row.changeShares ?? 0) >= 0,
	},
	{
		id: "reduce",
		label: "减持",
		predicate: (row) => (row.changeShares ?? 0) < 0,
	},
];
