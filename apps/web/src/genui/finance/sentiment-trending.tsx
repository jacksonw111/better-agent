import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { TrendingSentimentData } from "./finance-schemas-fe10";
import { formatCompact, formatNum } from "./format";
import { CardShell } from "./primitives";

// finance_sentiment_trending → 舆情热度榜: one row per trending ticker, a
// buzz bar (width = buzzScore, tinted by sentiment) plus a bull/bear split
// bar. Sentiment uses a neutral emerald/rose palette rather than 红涨绿跌 —
// bullish/bearish is a distinct axis from price direction and reusing the
// price-change colors here would be actively misleading.

const BULLISH_COLOR = "#10b981"; // emerald
const BEARISH_COLOR = "#f43f5e"; // rose
const NEUTRAL_COLOR = "#9ca3af"; // gray
const BULLISH_THRESHOLD = 0.05;
const BEARISH_THRESHOLD = -0.05;
const PCT_MAX = 100;
const ICON_SIZE = 14;
const BUZZ_DP = 0;

function sentimentColor(score: number): string {
	if (score > BULLISH_THRESHOLD) {
		return BULLISH_COLOR;
	}
	if (score < BEARISH_THRESHOLD) {
		return BEARISH_COLOR;
	}
	return NEUTRAL_COLOR;
}

function clampPct(n: number): number {
	return Math.min(Math.max(n, 0), PCT_MAX);
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

function BuzzBar({
	buzzScore,
	sentimentScore,
}: {
	buzzScore: number;
	sentimentScore: number;
}) {
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
			<div
				className="h-full rounded-full"
				style={{
					backgroundColor: sentimentColor(sentimentScore),
					width: `${clampPct(buzzScore)}%`,
				}}
			/>
		</div>
	);
}

function BullBearBar({
	bullishPct,
	bearishPct,
}: {
	bullishPct: number;
	bearishPct: number;
}) {
	return (
		<div className="flex h-1 w-full overflow-hidden rounded-full bg-muted">
			<div
				className="h-full"
				style={{
					backgroundColor: BULLISH_COLOR,
					width: `${clampPct(bullishPct)}%`,
				}}
			/>
			<div
				className="h-full"
				style={{
					backgroundColor: BEARISH_COLOR,
					width: `${clampPct(bearishPct)}%`,
				}}
			/>
		</div>
	);
}

function TrendingRow({ item }: { item: TrendingSentimentData }) {
	return (
		<div className="flex flex-col gap-1.5 py-2.5">
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate font-medium text-sm">
						{item.name || item.ticker}
					</span>
					<span className="shrink-0 text-muted-foreground text-xs">
						{item.ticker}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<TrendIcon trend={item.trend} />
					<span className="font-semibold text-sm tabular-nums">
						{formatNum(item.buzzScore, BUZZ_DP)}
					</span>
				</div>
			</div>
			<BuzzBar
				buzzScore={item.buzzScore}
				sentimentScore={item.sentimentScore}
			/>
			<div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
				<span>{formatCompact(item.mentions)} 提及</span>
				<span>
					看多 {formatNum(item.bullishPct, BUZZ_DP)}% · 看空{" "}
					{formatNum(item.bearishPct, BUZZ_DP)}%
				</span>
			</div>
			<BullBearBar bearishPct={item.bearishPct} bullishPct={item.bullishPct} />
		</div>
	);
}

/** finance_sentiment_trending → 舆情热度榜, capped at MAX_RENDERED_ITEMS —
 * this renders inline in chat, not a full leaderboard. */
export function SentimentTrending({ data }: { data: TrendingSentimentData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<CardShell title="舆情热度榜">
			<div className="flex flex-col divide-y">
				{visible.map((item) => (
					<TrendingRow item={item} key={item.ticker} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
