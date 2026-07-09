import type {
	MarketSentimentData,
	SentimentDriverData,
} from "./finance-schemas-fe10";
import { formatCompact, formatNum } from "./format";
import {
	CardShell,
	FinTable,
	type FinTableColumn,
	StatGrid,
} from "./primitives";

// finance_sentiment_market → overall market 舆情: buzz/sentiment header, a
// bull/bear split bar, a StatGrid, and a top-drivers table. Sentiment uses a
// neutral emerald/rose palette rather than 红涨绿跌 — bullish/bearish is a
// distinct axis from price direction.

const BULLISH_COLOR = "#10b981"; // emerald
const BEARISH_COLOR = "#f43f5e"; // rose
const NEUTRAL_COLOR = "#9ca3af"; // gray
const BULLISH_THRESHOLD = 0.05;
const BEARISH_THRESHOLD = -0.05;
const PCT_MAX = 100;
const BUZZ_DP = 0;
const SENTIMENT_SCORE_DP = 2;
const STAT_COLS = 4;

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

function BullBearBar({
	bullishPct,
	bearishPct,
}: {
	bullishPct: number;
	bearishPct: number;
}) {
	return (
		<div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
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

function SentimentScoreValue({ score }: { score: number }) {
	return (
		<span style={{ color: sentimentColor(score) }}>
			{score.toFixed(SENTIMENT_SCORE_DP)}
		</span>
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

/** finance_sentiment_market → overall market 舆情 snapshot: a big buzz
 * figure + trend, a bull/bear split bar, a StatGrid of the headline
 * aggregates, and a table of the top driver tickers. */
export function SentimentMarket({ data }: { data: MarketSentimentData }) {
	return (
		<CardShell title="市场整体舆情">
			<div className="flex items-baseline gap-3">
				<span className="font-bold text-3xl tabular-nums">
					{formatNum(data.buzzScore, BUZZ_DP)}
				</span>
				<span className="text-muted-foreground text-xs">
					{data.trend || "—"}
				</span>
			</div>
			<BullBearBar bearishPct={data.bearishPct} bullishPct={data.bullishPct} />
			<StatGrid
				cols={STAT_COLS}
				items={[
					{ label: "热度", value: formatNum(data.buzzScore, BUZZ_DP) },
					{
						label: "情绪分",
						value: <SentimentScoreValue score={data.sentimentScore} />,
					},
					{ label: "活跃标的", value: formatCompact(data.activeTickers) },
					{ label: "提及数", value: formatCompact(data.mentions) },
				]}
			/>
			{data.drivers.length > 0 ? (
				<FinTable
					columns={DRIVER_COLUMNS}
					getRowKey={(row, index) => row.ticker || String(index)}
					rows={data.drivers}
				/>
			) : null}
		</CardShell>
	);
}
