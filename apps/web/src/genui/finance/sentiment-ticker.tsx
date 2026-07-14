import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
	SENTIMENT_BEAR,
	SENTIMENT_BULL,
	SENTIMENT_NEUTRAL,
} from "./chart-theme";
import type { TickerSentimentData } from "./finance-schemas-fe10";
import { formatCompact, formatNum, formatRatio } from "./format";
import { CardShell } from "./primitives";
import { ProportionBar } from "./proportion-bar";
import { Sparkline } from "./sparkline";
import { StatPanel } from "./stat-panel";
import type { StatPanelGroup } from "./stat-panel-types";

// finance_sentiment_ticker → StatPanel (design doc §8.11): per-ticker 舆情 —
// a big buzz headline + trend icon, a lead StatGrid, a bull/bear split
// ProportionBar (SHARED primitive, split mode), a raw post-count breakdown,
// and a Sparkline of the daily buzz trend behind Expand. Every bull/bear/
// neutral color comes from chart-theme's sentiment axis (SENTIMENT_BULL/
// BEAR/NEUTRAL) — a distinct axis from the price axis's 红涨绿跌, never mixed.

const BULLISH_THRESHOLD = 0.05;
const BEARISH_THRESHOLD = -0.05;
const PCT_MAX = 100;
const ICON_SIZE = 16;
const BUZZ_DP = 0;
const SENTIMENT_SCORE_DP = 2;
const PCT_DP = 0;
const LEAD_COLS = 3;
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
		<div className="flex items-center justify-between gap-2">
			<span className="font-bold text-3xl tabular-nums">
				{formatNum(buzzScore, BUZZ_DP)}
			</span>
			<TrendIcon trend={trend} />
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

/** Daily buzz trend, folded behind Expand. `tone="neutral"` deliberately —
 * buzz volume isn't a signed price series, so it never borrows the price
 * axis's up/down colors. */
function DailyTrend({ dailyTrend }: { dailyTrend: { buzzScore: number }[] }) {
	return (
		<Sparkline tone="neutral" values={dailyTrend.map((d) => d.buzzScore)} />
	);
}

function tickerTitle(data: TickerSentimentData): string {
	return data.name ? `${data.ticker} ${data.name}` : data.ticker;
}

function tickerSubtitle(data: TickerSentimentData): string | undefined {
	const parts = [data.trend || "—", `${data.periodDays}天`].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function tickerGroups(data: TickerSentimentData): StatPanelGroup[] {
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

/** finance_sentiment_ticker → per-ticker 舆情 snapshot. `found: false`
 * (ticker has no sentiment coverage) short-circuits to a muted note rather
 * than rendering a card full of zeros. */
export function SentimentTicker({ data }: { data: TickerSentimentData }) {
	if (!data.found) {
		return (
			<CardShell subtitle={data.ticker} title={tickerTitle(data)}>
				<p className="text-muted-foreground text-xs">无数据</p>
			</CardShell>
		);
	}
	const expandable =
		data.dailyTrend.length > 0
			? {
					content: <DailyTrend dailyTrend={data.dailyTrend} />,
					label: "近期趋势",
				}
			: undefined;
	return (
		<StatPanel
			expandable={expandable}
			groups={tickerGroups(data)}
			subtitle={tickerSubtitle(data)}
			title={tickerTitle(data)}
		/>
	);
}
