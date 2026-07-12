import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { CnHotRowData } from "./finance-schemas-fe12";
import { formatNum } from "./format";
import { CardShell, ChangePct } from "./primitives";

// finance_cn_hot → 股吧人气榜: a ranked list of A股 tickers by attention, with
// last price, change % (红涨绿跌 — price direction, via ChangePct), and a
// rank-change badge. Rank-change is a distinct axis from price ("attention
// rising" vs. "price up"), so it gets its own neutral emerald/gray palette
// rather than reusing the price-change colors (same reasoning as
// sentiment-trending.tsx).

const RISE_COLOR = "#10b981"; // emerald — attention rank rising
const FALL_COLOR = "#9ca3af"; // muted gray — falling attention isn't "bad"
// the way a price drop is, so it doesn't get an alarm color
const ICON_SIZE = 13;
const RANK_CHANGE_DP = 0;

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

function HotListRow({ item }: { item: CnHotRowData }) {
	return (
		<div className="flex items-center justify-between gap-2 px-1 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<span className="w-5 shrink-0 text-right font-bold text-sm tabular-nums">
					{item.rank}
				</span>
				<div className="flex min-w-0 flex-col">
					<span className="truncate font-medium text-sm">
						{item.name || item.code}
					</span>
					<span className="truncate text-muted-foreground text-xs">
						{item.code}
					</span>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-3">
				<span className="text-sm tabular-nums">{formatNum(item.last)}</span>
				<ChangePct value={item.changePct} />
				<RankChangeBadge rankChange={item.rankChange} />
			</div>
		</div>
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
	return (
		<CardShell title="股吧人气榜">
			<div className="flex flex-col divide-y">
				{visible.map((item) => (
					<HotListRow item={item} key={item.code} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
