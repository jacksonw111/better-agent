import {
	SENTIMENT_BEAR,
	SENTIMENT_BULL,
	SENTIMENT_NEUTRAL,
} from "./chart-theme";
import type {
	MarketSentimentData,
	SentimentDriverData,
} from "./finance-schemas-fe10";
import { formatCompact, formatNum, formatRatio } from "./format";
import { FinTable, type FinTableColumn } from "./primitives";
import { ProportionBar } from "./proportion-bar";
import { StatPanel } from "./stat-panel";
import type { StatPanelGroup } from "./stat-panel-types";

// finance_sentiment_market → StatPanel (design doc §8.11): overall market
// 舆情 — a big buzz headline, a lead StatGrid, a bull/bear split
// ProportionBar (SHARED primitive, split mode — never a bespoke <div> bar),
// a raw post-count breakdown, and the top-driver tickers behind Expand.
// Every bull/bear/neutral color comes from chart-theme's sentiment axis
// (SENTIMENT_BULL/BEAR/NEUTRAL) — a distinct axis from the price axis's
// 红涨绿跌 (UP_COLOR/DOWN_COLOR), never mixed.

const BULLISH_THRESHOLD = 0.05;
const BEARISH_THRESHOLD = -0.05;
const PCT_MAX = 100;
const BUZZ_DP = 0;
const SENTIMENT_SCORE_DP = 2;
const PCT_DP = 0;
const LEAD_COLS = 4;
const COUNT_COLS = 3;

function sentimentColor(score: number): string {
	if (score > BULLISH_THRESHOLD) {
		return SENTIMENT_BULL;
	}
	if (score < BEARISH_THRESHOLD) {
		return SENTIMENT_BEAR;
	}
	return SENTIMENT_NEUTRAL;
}

function toFraction(pct: number): number {
	return Math.min(Math.max(pct, 0), PCT_MAX) / PCT_MAX;
}

function SentimentScoreValue({ score }: { score: number }) {
	return (
		<span style={{ color: sentimentColor(score) }}>
			{score.toFixed(SENTIMENT_SCORE_DP)}
		</span>
	);
}

function BuzzHeadline({
	buzzScore,
	trend,
}: {
	buzzScore: number;
	trend: string;
}) {
	return (
		<div className="flex items-baseline gap-3">
			<span className="font-bold text-3xl tabular-nums">
				{formatNum(buzzScore, BUZZ_DP)}
			</span>
			<span className="text-muted-foreground text-xs">{trend || "—"}</span>
		</div>
	);
}

/** The 看多/看空 split ProportionBar plus the exact percentages as text
 * underneath it (mirrors sentiment-compare.tsx's bar+renderSecondary pair,
 * so the split proportions are always readable as numbers too). */
function BullBearSection({
	bearishPct,
	bullishPct,
	sentimentScore,
}: {
	bearishPct: number;
	bullishPct: number;
	sentimentScore: number;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<ProportionBar
				label="看多/看空"
				segments={[
					{
						color: SENTIMENT_BULL,
						fraction: toFraction(bullishPct),
						key: "bull",
					},
					{
						color: SENTIMENT_BEAR,
						fraction: toFraction(bearishPct),
						key: "bear",
					},
				]}
				valueLabel={<SentimentScoreValue score={sentimentScore} />}
			/>
			<div className="flex justify-end gap-3 text-xs tabular-nums">
				<span style={{ color: SENTIMENT_BULL }}>
					看多 {formatRatio(bullishPct, PCT_DP)}
				</span>
				<span style={{ color: SENTIMENT_BEAR }}>
					看空 {formatRatio(bearishPct, PCT_DP)}
				</span>
			</div>
		</div>
	);
}

const DRIVER_COLUMNS: FinTableColumn<SentimentDriverData>[] = [
	{
		key: "ticker",
		label: "标的",
		render: (row) => row.ticker || "—",
	},
	{
		align: "right",
		key: "mentions",
		label: "提及数",
		render: (row) => formatCompact(row.mentions),
	},
	{
		align: "right",
		key: "buzzScore",
		label: "热度",
		render: (row) => formatNum(row.buzzScore, BUZZ_DP),
	},
	{
		align: "right",
		key: "sentimentScore",
		label: "情绪分",
		render: (row) => <SentimentScoreValue score={row.sentimentScore} />,
	},
];

function DriversTable({ drivers }: { drivers: SentimentDriverData[] }) {
	return (
		<FinTable
			columns={DRIVER_COLUMNS}
			getRowKey={(row, index) => row.ticker || String(index)}
			rows={drivers}
		/>
	);
}

function marketGroups(data: MarketSentimentData): StatPanelGroup[] {
	return [
		{ content: <BuzzHeadline buzzScore={data.buzzScore} trend={data.trend} /> },
		{
			cols: LEAD_COLS,
			items: [
				{ label: "热度", value: formatNum(data.buzzScore, BUZZ_DP) },
				{
					label: "情绪分",
					value: <SentimentScoreValue score={data.sentimentScore} />,
				},
				{ label: "活跃标的", value: formatCompact(data.activeTickers) },
				{ label: "提及数", value: formatCompact(data.mentions) },
			],
		},
		{
			content: (
				<BullBearSection
					bearishPct={data.bearishPct}
					bullishPct={data.bullishPct}
					sentimentScore={data.sentimentScore}
				/>
			),
		},
		{
			cols: COUNT_COLS,
			items: [
				{ label: "正面", value: formatCompact(data.positiveCount) },
				{ label: "中性", value: formatCompact(data.neutralCount) },
				{ label: "负面", value: formatCompact(data.negativeCount) },
			],
			label: "帖子情绪",
		},
	];
}

/** finance_sentiment_market → overall market 舆情 snapshot. */
export function SentimentMarket({ data }: { data: MarketSentimentData }) {
	const expandable =
		data.drivers.length > 0
			? { content: <DriversTable drivers={data.drivers} />, label: "驱动标的" }
			: undefined;
	return (
		<StatPanel
			expandable={expandable}
			groups={marketGroups(data)}
			title="市场整体舆情"
		/>
	);
}
