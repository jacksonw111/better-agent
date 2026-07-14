import { MAX_RENDERED_ITEMS } from "../registry/entry";
import type { DragonTigerRowData } from "./finance-schemas";
import { formatCompact, formatDate, formatNum, formatRatio } from "./format";
import { ChangePct } from "./primitives";
import { RankList, RankListMoreFooter } from "./rank-list";
import type { RankListSortOption } from "./rank-list-types";

// finance_dragon_tiger → 龙虎榜, ported onto the `RankList` archetype (design
// doc §8.6). RECLASSIFIED from the doc's original LadderTable slot (§8.5/§9,
// 买方席位|卖方席位 mirror): `DragonTigerRowData` carries no seat-level
// buy/sell data — the EastMoney dragon-tiger billboard source returns a
// per-STOCK list (tradeDate/code/name/close/changePct/turnoverRate/
// billboardAmount/reason), so a buy/sell mirror is impossible without
// inventing data the payload doesn't carry. Ranked by 龙虎榜成交额
// (billboardAmount) — the natural "who traded biggest today" order. Tone is
// fixed "probability": an amount magnitude, not itself a price move, stays
// off the price axis (§5.2 axis purity). `reason` (上榜原因) is NOT wired as
// a Filter: EastMoney billboard reasons are long, frequently per-row-unique
// free text (date thresholds, cumulative %, seat-count phrasing folded into
// the string), not a small closed set — building a Filter from it would risk
// bucketing into many one-row options, the same "don't invent a dimension"
// failure mode as fabricating a filter outright. `reason` still gets a real
// purpose via `renderExpanded` instead (full text on drill-down, truncated
// nowhere in the collapsed row).

const SORT_OPTIONS: RankListSortOption<DragonTigerRowData>[] = [
	{ accessor: (row) => row.changePct, id: "changePct", label: "涨跌幅" },
	{ accessor: (row) => row.turnoverRate, id: "turnoverRate", label: "换手率" },
];

function DragonTigerPrimary({ item }: { item: DragonTigerRowData }) {
	return (
		<div className="flex min-w-0 flex-col">
			<span className="truncate font-medium text-sm">
				{item.name || item.code}
			</span>
			<span className="truncate text-muted-foreground text-xs">
				{item.code}
			</span>
		</div>
	);
}

function DragonTigerSecondary({ item }: { item: DragonTigerRowData }) {
	return (
		<>
			<span className="text-sm tabular-nums">{formatNum(item.close)}</span>
			<ChangePct value={item.changePct} />
		</>
	);
}

function DragonTigerExpanded({ item }: { item: DragonTigerRowData }) {
	return (
		<p className="text-muted-foreground text-xs">
			换手率 {formatRatio(item.turnoverRate)} · {item.reason || "—"}
		</p>
	);
}

/** finance_dragon_tiger → 龙虎榜, ranked by 龙虎榜成交额, capped at
 * MAX_RENDERED_ITEMS. Subtitle shows the trade date of the first row, which
 * the source query is always scoped to a single date. */
export function DragonTigerTable({ data }: { data: DragonTigerRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;

	return (
		<RankList
			footer={
				hiddenCount > 0 ? <RankListMoreFooter count={hiddenCount} /> : null
			}
			getRowKey={(item, index) => `${item.code}-${index}`}
			items={visible}
			metricLabel="龙虎榜成交额"
			metricTone="probability"
			metricValue={(item) => formatCompact(item.billboardAmount, { cny: true })}
			rankMetric={(item) => item.billboardAmount}
			renderExpanded={(item) => <DragonTigerExpanded item={item} />}
			renderPrimary={(item) => <DragonTigerPrimary item={item} />}
			renderSecondary={(item) => <DragonTigerSecondary item={item} />}
			sortOptions={SORT_OPTIONS}
			subtitle={formatDate(data[0]?.tradeDate)}
			title="龙虎榜"
		/>
	);
}
