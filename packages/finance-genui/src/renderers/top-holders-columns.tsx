import { Badge } from "../components/badge";
import type { DataTableColumn } from "./data-table-types";
import type { HolderRowData } from "./finance-schemas";
import { changeColor, formatCompact, formatRatio } from "./format";
import { ChangePct, type StatGridItem } from "./primitives";
import { ProportionBar } from "./proportion-bar";

// Phase 1 Batch B2 — column config for `top_holders` (design doc §9), ported
// field-for-field from the pre-DataTable top-holders-table.tsx's FinTable
// columns. `holder` is the categoryKey (sticky-left) but, unlike every other
// DataTable tool, it's a shareholder *name* rather than a date/period — not
// orderable, so no column here is marked `isMetric` (no Pivot chart makes
// sense across an unordered set of holder names; spec §9). That in turn means
// `metric-expand.ts`'s `expandedMetricFields` (which only surfaces
// `isMetric`+`value` columns) would return nothing for this table, so
// `holderExpandedItems` below builds the row-detail expand directly from
// every non-category column's own `render`, instead of reusing that helper.

const PERCENT_SCALE = 100;

/** Signed compact share-count delta, colored red-up/green-down (红涨绿跌) like
 * `ChangePct`, but for an absolute share count rather than a percentage. */
function SignedShares({ value }: { value: number | null }) {
	if (value === null || Number.isNaN(value)) {
		return <span className="text-muted-foreground">—</span>;
	}
	const color = changeColor(value);
	const sign = value > 0 ? "+" : "";
	return (
		<span style={color ? { color } : undefined}>
			{sign}
			{formatCompact(value)}
		</span>
	);
}

function HolderName({ row }: { row: HolderRowData }) {
	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<span className="max-w-48 truncate" title={row.holder}>
				{row.holder}
			</span>
			{row.isInstitution ? (
				<Badge className="shrink-0" variant="outline">
					机构
				</Badge>
			) : null}
		</div>
	);
}

/** §8.6/§9's "占比列内嵌 ProportionBar": the 持股占比 cell renders a neutral
 * (non-directional) proportion bar with the % as its `valueLabel`, rather
 * than bare text — null falls back to the muted "—" every other cell uses. */
function HolderRatioCell({ value }: { value: number | null }) {
	if (value === null || Number.isNaN(value)) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<ProportionBar
			fraction={value / PERCENT_SCALE}
			tone="neutral"
			valueLabel={formatRatio(value)}
		/>
	);
}

const RANK_COLUMN: DataTableColumn<HolderRowData> = {
	align: "right",
	key: "rank",
	label: "排名",
	render: (row) => row.rank ?? "—",
	value: (row) => row.rank,
};

const HOLDER_COLUMN: DataTableColumn<HolderRowData> = {
	key: "holder",
	label: "股东名称",
	render: (row) => <HolderName row={row} />,
};

const SHARES_COLUMN: DataTableColumn<HolderRowData> = {
	align: "right",
	key: "shares",
	label: "持股数",
	render: (row) => formatCompact(row.shares),
	value: (row) => row.shares,
};

const RATIO_COLUMN: DataTableColumn<HolderRowData> = {
	align: "right",
	key: "freeFloatRatio",
	label: "流通占比",
	render: (row) => <HolderRatioCell value={row.freeFloatRatio} />,
	value: (row) => row.freeFloatRatio,
};

const CHANGE_SHARES_COLUMN: DataTableColumn<HolderRowData> = {
	align: "right",
	key: "changeShares",
	label: "较上期变动",
	render: (row) => <SignedShares value={row.changeShares} />,
	value: (row) => row.changeShares,
};

const CHANGE_RATIO_COLUMN: DataTableColumn<HolderRowData> = {
	align: "right",
	key: "changeRatio",
	label: "变动比例",
	render: (row) => <ChangePct value={row.changeRatio} />,
	value: (row) => row.changeRatio,
};

/** `holder` (categoryKey) plus every column the pre-DataTable component
 * rendered, each sortable-by 持股数/占比-and-friends but deliberately not
 * `isMetric` — see the module note above. */
export function holderColumns(): DataTableColumn<HolderRowData>[] {
	return [
		RANK_COLUMN,
		HOLDER_COLUMN,
		SHARES_COLUMN,
		RATIO_COLUMN,
		CHANGE_SHARES_COLUMN,
		CHANGE_RATIO_COLUMN,
	];
}

/** Row-detail expand for a single holder — every non-category column's own
 * rendered cell (持股变动 etc.), so the expand always matches what the grid
 * shows. See the module note for why this can't reuse `expandedMetricFields`. */
export function holderExpandedItems(
	columns: DataTableColumn<HolderRowData>[],
	row: HolderRowData
): StatGridItem[] {
	return columns
		.filter((col) => col.key !== HOLDER_COLUMN.key)
		.map((col) => ({
			label: col.label,
			value: col.render ? col.render(row) : "—",
		}));
}
