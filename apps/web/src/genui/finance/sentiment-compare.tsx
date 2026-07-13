import type { ReactNode } from "react";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import { SENTIMENT_BEAR, SENTIMENT_BULL } from "./chart-theme";
import type { SentimentCompareData } from "./finance-schemas-fe12";
import { formatCompact, formatRatio } from "./format";
import { RankList, RankListMoreFooter } from "./rank-list";
import type { RankListSortOption } from "./rank-list-types";

// finance_sentiment_compare → 舆情对比, ported onto the `RankList` archetype
// (design doc §8.6/§9 "每行 bull/bear ProportionBar" ⚠). Each row's headline
// line is a bull/bear SPLIT ProportionBar (`metricSegments`,
// SENTIMENT_BULL|SENTIMENT_BEAR from chart-theme's sentiment axis — never
// the price axis's red/green, §5.2 axis purity), with the ticker's sentiment
// score at the bar's right edge. `rankMetric` = sentimentScore, so the
// default rank order and the "看多看空" auto Sort option both track it
// directly; `renderSecondary` prints the exact 看多/看空 percentages so the
// split bar's proportions are always readable as numbers too.

const SCORE_DP = 2;
const PCT_DP = 0;
const PCT_MAX = 100;

const SORT_OPTIONS: RankListSortOption<SentimentCompareData>[] = [
	{ accessor: (row) => row.buzzScore, id: "buzzScore", label: "热度" },
];

function toFraction(pct: number): number {
	return Math.min(Math.max(pct, 0), PCT_MAX) / PCT_MAX;
}

function scoreColor(score: number): string | undefined {
	if (score > 0) {
		return SENTIMENT_BULL;
	}
	if (score < 0) {
		return SENTIMENT_BEAR;
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

function ScoreLabel({ score }: { score: number }): ReactNode {
	const sign = score > 0 ? "+" : "";
	return (
		<span
			style={{ color: scoreColor(score) }}
		>{`${sign}${score.toFixed(SCORE_DP)}`}</span>
	);
}

function ComparePrimary({ item }: { item: SentimentCompareData }) {
	return (
		<div className="flex min-w-0 flex-col">
			<span className="truncate font-medium text-sm">
				{item.name || item.ticker}
			</span>
			<span className="truncate text-muted-foreground text-xs">
				{item.ticker}
			</span>
		</div>
	);
}

function CompareSecondary({ item }: { item: SentimentCompareData }) {
	return (
		<span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
			<span style={{ color: SENTIMENT_BULL }}>
				看多 {formatRatio(item.bullishPct, PCT_DP)}
			</span>
			<span style={{ color: SENTIMENT_BEAR }}>
				看空 {formatRatio(item.bearishPct, PCT_DP)}
			</span>
		</span>
	);
}

function CompareExpanded({ item }: { item: SentimentCompareData }) {
	return (
		<p className="text-muted-foreground text-xs">
			{formatCompact(item.mentions)} 提及 · 热度{" "}
			{formatRatio(item.buzzScore, PCT_DP)}
		</p>
	);
}

/** finance_sentiment_compare → 舆情对比, ranked by sentiment score, capped at
 * MAX_RENDERED_ITEMS — this renders inline in chat, not a full comparison
 * table. */
export function SentimentCompare({ data }: { data: SentimentCompareData[] }) {
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
			metricLabel="看多看空"
			metricSegments={(item) => [
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
			metricValue={(item) => <ScoreLabel score={item.sentimentScore} />}
			rankMetric={(item) => item.sentimentScore}
			renderExpanded={(item) => <CompareExpanded item={item} />}
			renderPrimary={(item) => <ComparePrimary item={item} />}
			renderSecondary={(item) => <CompareSecondary item={item} />}
			sortOptions={SORT_OPTIONS}
			title="舆情对比"
		/>
	);
}
