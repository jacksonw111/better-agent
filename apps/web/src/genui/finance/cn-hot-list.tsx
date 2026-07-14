import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { CnHotRowData } from "./finance-schemas-fe12";
import { formatNum } from "./format";
import { ChangePct } from "./primitives";
import { RankList, RankListMoreFooter } from "./rank-list";
import type { RankListSortOption } from "./rank-list-types";

// finance_cn_hot → 股吧人气榜, ported onto the `RankList` archetype (design
// doc §8.6, contract So·F·E·I). No field for 热度's raw score exists on
// `CnHotRowData` (§8.6 assumes the payload carries one — this tool doesn't),
// so the headline metric is a linear proxy derived from the tool's own
// 排名 order: `visibleCount - rank + 1` — rank 1 gets the fullest bar, and it
// decays linearly across the currently rendered set. Filter is omitted
// entirely: the schema carries no discrete field to filter by (never invent
// one). Rank-change is a distinct axis from price ("attention rising" vs.
// "price up"), so it keeps its own neutral emerald/gray palette rather than
// reusing the price-change colors (same reasoning as sentiment-trending.tsx).

const RISE_COLOR = "#10b981"; // emerald — attention rank rising
const FALL_COLOR = "#9ca3af"; // muted gray — falling attention isn't "bad"
// the way a price drop is, so it doesn't get an alarm color
const ICON_SIZE = 13;
const RANK_CHANGE_DP = 0;

const SORT_OPTIONS: RankListSortOption<CnHotRowData>[] = [
	{ accessor: (row) => row.changePct, id: "changePct", label: "涨跌幅" },
];

function RankChangeBadge({ rankChange }: { rankChange: number | null }) {
	if (rankChange === null || rankChange === 0) {
		return (
			<span className="flex items-center gap-0.5 text-muted-foreground text-xs">
				<Minus size={ICON_SIZE} />
			</span>
		);
	}
	if (rankChange > 0) {
		return (
			<span
				className="flex items-center gap-0.5 text-xs tabular-nums"
				style={{ color: RISE_COLOR }}
			>
				<TrendingUp size={ICON_SIZE} />
				{formatNum(rankChange, RANK_CHANGE_DP)}
			</span>
		);
	}
	return (
		<span
			className="flex items-center gap-0.5 text-xs tabular-nums"
			style={{ color: FALL_COLOR }}
		>
			<TrendingDown size={ICON_SIZE} />
			{formatNum(Math.abs(rankChange), RANK_CHANGE_DP)}
		</span>
	);
}

function HotPrimary({ item }: { item: CnHotRowData }) {
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

// Fixed-width, right-aligned columns so 价格 / 涨跌幅 / 排名变动 line up
// vertically across rows instead of drifting with each value's own width.
function HotSecondary({ item }: { item: CnHotRowData }) {
	return (
		<>
			<span className="w-16 text-right text-sm tabular-nums">
				{formatNum(item.last)}
			</span>
			<ChangePct className="w-16 text-right" value={item.changePct} />
			<span className="flex w-9 justify-end">
				<RankChangeBadge rankChange={item.rankChange} />
			</span>
		</>
	);
}

/** finance_cn_hot → 股吧人气榜, capped at MAX_RENDERED_ITEMS — this renders
 * inline in chat, not a full leaderboard. */
export function CnHotList({ data }: { data: CnHotRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	const heat = (item: CnHotRowData) => visible.length - item.rank + 1;

	return (
		<RankList
			footer={
				hiddenCount > 0 ? <RankListMoreFooter count={hiddenCount} /> : null
			}
			getRowKey={(item) => item.code}
			items={visible}
			metricLabel="热度"
			metricTone="probability"
			rankMetric={heat}
			renderPrimary={(item) => <HotPrimary item={item} />}
			renderSecondary={(item) => <HotSecondary item={item} />}
			sortOptions={SORT_OPTIONS}
			title="股吧人气榜"
		/>
	);
}
