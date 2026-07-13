import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import {
	SENTIMENT_BEAR,
	SENTIMENT_BULL,
	SENTIMENT_NEUTRAL,
} from "./chart-theme";
import type { TrendingSentimentData } from "./finance-schemas-fe10";
import { formatCompact, formatNum, formatRatio } from "./format";
import { ProportionBar } from "./proportion-bar";
import { RankList, RankListMoreFooter } from "./rank-list";
import type { RankListSortOption } from "./rank-list-types";

// finance_sentiment_trending → 舆情热度榜, ported onto the `RankList`
// archetype (design doc §8.6/§9, contract So·F·E·I). Headline metric = buzz/
// 热度 (ProportionBar, "probability" tone — a magnitude, not itself a signed
// sentiment, §5.2 axis purity). A second bull/bear split ProportionBar
// (SENTIMENT_BULL|SENTIMENT_BEAR from chart-theme's sentiment axis — never
// the price axis's red/green) lives in the row's Expand region alongside
// mentions/uniquePosts, since RankListRow's header + headline-bar slots are
// already spoken for by rank/name/trend/buzz.

const ICON_SIZE = 14;
const BUZZ_DP = 0;
const PCT_DP = 0;
const PCT_MAX = 100;

const SORT_OPTIONS: RankListSortOption<TrendingSentimentData>[] = [
	{
		accessor: (row) => row.sentimentScore,
		id: "sentimentScore",
		label: "情绪分",
	},
];

function isRisingTrend(trend: string): boolean {
	const lower = trend.toLowerCase();
	return (
		lower.includes("ris") || lower.includes("bull") || lower.includes("up")
	);
}

function isFallingTrend(trend: string): boolean {
	const lower = trend.toLowerCase();
	return (
		lower.includes("fall") || lower.includes("bear") || lower.includes("down")
	);
}

function TrendIcon({ trend }: { trend: string }) {
	if (isRisingTrend(trend)) {
		return (
			<TrendingUp
				className="shrink-0"
				color={SENTIMENT_BULL}
				size={ICON_SIZE}
			/>
		);
	}
	if (isFallingTrend(trend)) {
		return (
			<TrendingDown
				className="shrink-0"
				color={SENTIMENT_BEAR}
				size={ICON_SIZE}
			/>
		);
	}
	return (
		<Minus className="shrink-0" color={SENTIMENT_NEUTRAL} size={ICON_SIZE} />
	);
}

function toFraction(pct: number): number {
	return Math.min(Math.max(pct, 0), PCT_MAX) / PCT_MAX;
}

function TrendingPrimary({ item }: { item: TrendingSentimentData }) {
	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<span className="truncate font-medium text-sm">
				{item.name || item.ticker}
			</span>
			<span className="shrink-0 text-muted-foreground text-xs">
				{item.ticker}
			</span>
		</div>
	);
}

function TrendingSecondary({ item }: { item: TrendingSentimentData }) {
	return (
		<>
			<TrendIcon trend={item.trend} />
			<span className="text-muted-foreground text-xs">
				{formatCompact(item.mentions)} 提及
			</span>
		</>
	);
}

function TrendingExpanded({ item }: { item: TrendingSentimentData }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between text-xs">
				<span style={{ color: SENTIMENT_BULL }}>
					看多 {formatRatio(item.bullishPct, PCT_DP)}
				</span>
				<span style={{ color: SENTIMENT_BEAR }}>
					看空 {formatRatio(item.bearishPct, PCT_DP)}
				</span>
			</div>
			<ProportionBar
				segments={[
					{
						color: SENTIMENT_BULL,
						fraction: toFraction(item.bullishPct),
						key: "bull",
					},
					{
						color: SENTIMENT_BEAR,
						fraction: toFraction(item.bearishPct),
						key: "bear",
					},
				]}
			/>
			<span className="text-muted-foreground text-xs">
				{formatCompact(item.uniquePosts)} 独立发帖
			</span>
		</div>
	);
}

/** finance_sentiment_trending → 舆情热度榜, ranked by buzz (headline metric),
 * capped at MAX_RENDERED_ITEMS. */
export function SentimentTrending({ data }: { data: TrendingSentimentData[] }) {
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
			getRowKey={(item, index) => `${item.ticker}-${index}`}
			items={visible}
			metricLabel="热度"
			metricTone="probability"
			metricValue={(item) => formatNum(item.buzzScore, BUZZ_DP)}
			rankMetric={(item) => item.buzzScore}
			renderExpanded={(item) => <TrendingExpanded item={item} />}
			renderPrimary={(item) => <TrendingPrimary item={item} />}
			renderSecondary={(item) => <TrendingSecondary item={item} />}
			sortOptions={SORT_OPTIONS}
			title="舆情热度榜"
		/>
	);
}
