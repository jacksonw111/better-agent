"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { TickerSentimentData } from "./finance-schemas-fe10";
import { formatCompact, formatDate, formatNum, formatRatio } from "./format";
import { CardShell, StatGrid } from "./primitives";

// finance_sentiment_ticker → per-ticker 舆情: buzz header + trend, a
// positive/neutral/negative split bar, a StatGrid of the headline figures,
// and a small daily-buzz trend line. Sentiment uses a neutral emerald/rose
// palette rather than 红涨绿跌 — bullish/bearish is a distinct axis from
// price direction.

const BULLISH_COLOR = "#10b981"; // emerald
const BEARISH_COLOR = "#f43f5e"; // rose
const NEUTRAL_COLOR = "#9ca3af"; // gray
const LINE_COLOR = "#3b82f6"; // neutral blue — buzz isn't a signed series
const BULLISH_THRESHOLD = 0.05;
const BEARISH_THRESHOLD = -0.05;
const PCT_MAX = 100;
const ICON_SIZE = 16;
const BUZZ_DP = 0;
const SENTIMENT_SCORE_DP = 2;
const CHART_HEIGHT = 140;
const TICK_FONT_SIZE = 11;
const LINE_STROKE_WIDTH = 2;
const DOT_RADIUS = 3;
const AXIS_LABEL_LENGTH = 5; // "MM-DD" tail of the formatted date
const GRID_COLOR = "var(--border)";

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

function sentimentColor(score: number): string {
	if (score > BULLISH_THRESHOLD) {
		return BULLISH_COLOR;
	}
	if (score < BEARISH_THRESHOLD) {
		return BEARISH_COLOR;
	}
	return NEUTRAL_COLOR;
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
			<TrendingUp className="shrink-0" color={BULLISH_COLOR} size={ICON_SIZE} />
		);
	}
	if (isFallingTrend(trend)) {
		return (
			<TrendingDown
				className="shrink-0"
				color={BEARISH_COLOR}
				size={ICON_SIZE}
			/>
		);
	}
	return <Minus className="shrink-0" color={NEUTRAL_COLOR} size={ICON_SIZE} />;
}

function SentimentScoreValue({ score }: { score: number }) {
	return (
		<span style={{ color: sentimentColor(score) }}>
			{score.toFixed(SENTIMENT_SCORE_DP)}
		</span>
	);
}

/** Three-segment 看多/中性/看空 split bar from raw post counts. The neutral
 * segment is computed as the remainder (rather than its own percentage) so
 * the three widths always sum to exactly 100% regardless of rounding. */
function SplitBar({
	positive,
	negative,
	neutral,
}: {
	positive: number;
	negative: number;
	neutral: number;
}) {
	const total = positive + negative + neutral;
	if (total <= 0) {
		return null;
	}
	const posPct = (positive / total) * PCT_MAX;
	const negPct = (negative / total) * PCT_MAX;
	const neuPct = PCT_MAX - posPct - negPct;
	return (
		<div className="flex h-1.5 w-full overflow-hidden rounded-full">
			<div
				className="h-full"
				style={{ backgroundColor: BULLISH_COLOR, width: `${posPct}%` }}
			/>
			<div
				className="h-full"
				style={{ backgroundColor: NEUTRAL_COLOR, width: `${neuPct}%` }}
			/>
			<div
				className="h-full"
				style={{ backgroundColor: BEARISH_COLOR, width: `${negPct}%` }}
			/>
		</div>
	);
}

interface ChartRow {
	buzzScore: number;
	date: string;
}

function formatAxisTick(date: string): string {
	return formatDate(date).slice(-AXIS_LABEL_LENGTH);
}

function TrendChart({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
				<CartesianGrid
					stroke={GRID_COLOR}
					strokeDasharray="3 3"
					vertical={false}
				/>
				<XAxis
					dataKey="date"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={formatAxisTick}
				/>
				<YAxis
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					formatter={(value) => [formatNum(Number(value), BUZZ_DP), "热度"]}
					labelFormatter={(label: string) => formatDate(label)}
				/>
				<Line
					dataKey="buzzScore"
					dot={{ fill: LINE_COLOR, r: DOT_RADIUS }}
					stroke={LINE_COLOR}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}

/** finance_sentiment_ticker → header (buzz + trend), a 看多/中性/看空 split
 * bar, a StatGrid of the headline figures, and a small daily buzz trend
 * line. `found: false` (ticker has no sentiment coverage) short-circuits to
 * a muted note rather than rendering a card full of zeros. */
export function SentimentTicker({ data }: { data: TickerSentimentData }) {
	const title = `${data.name || data.ticker} 舆情`;
	if (!data.found) {
		return (
			<CardShell subtitle={data.ticker} title={title}>
				<p className="text-muted-foreground text-xs">无数据</p>
			</CardShell>
		);
	}
	const chartData: ChartRow[] = data.dailyTrend.map((point) => ({
		buzzScore: point.buzzScore,
		date: point.date,
	}));
	return (
		<CardShell subtitle={data.ticker} title={title}>
			<div className="flex items-center justify-between gap-2">
				<span className="font-bold text-3xl tabular-nums">
					{formatNum(data.buzzScore, BUZZ_DP)}
				</span>
				<TrendIcon trend={data.trend} />
			</div>
			<SplitBar
				negative={data.negativeCount}
				neutral={data.neutralCount}
				positive={data.positiveCount}
			/>
			<StatGrid
				items={[
					{ label: "舆情热度", value: formatNum(data.buzzScore, BUZZ_DP) },
					{ label: "提及数", value: formatCompact(data.mentions) },
					{
						label: "情绪分",
						value: <SentimentScoreValue score={data.sentimentScore} />,
					},
					{ label: "看多%", value: formatRatio(data.bullishPct, BUZZ_DP) },
					{ label: "看空%", value: formatRatio(data.bearishPct, BUZZ_DP) },
					{ label: "周期天数", value: `${data.periodDays}天` },
				]}
			/>
			{chartData.length > 0 ? <TrendChart data={chartData} /> : null}
		</CardShell>
	);
}
