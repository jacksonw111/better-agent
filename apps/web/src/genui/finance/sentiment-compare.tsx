"use client";

import {
	Bar,
	BarChart,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { SentimentCompareData } from "./finance-schemas-fe12";
import { formatNum } from "./format";
import { CardShell } from "./primitives";

// finance_sentiment_compare → 舆情对比: a horizontal bar chart of buzzScore
// across tickers, plus a compact bull/bear split row per ticker. Sentiment
// uses a neutral emerald/rose palette rather than 红涨绿跌 (see
// sentiment-trending.tsx) — bullish/bearish is a distinct axis from price
// direction and reusing the price-change colors here would be misleading.

const CHART_HEIGHT = 200;
const TICK_FONT_SIZE = 11;
const BULLISH_COLOR = "#10b981"; // emerald
const BEARISH_COLOR = "#f43f5e"; // rose
const NEUTRAL_COLOR = "#9ca3af"; // gray
const BULLISH_THRESHOLD = 0.05;
const BEARISH_THRESHOLD = -0.05;
const PCT_MAX = 100;
const BUZZ_DP = 0;
const Y_AXIS_WIDTH = 64;

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

function clampPct(n: number): number {
	return Math.min(Math.max(n, 0), PCT_MAX);
}

interface ChartRow {
	buzzScore: number;
	label: string;
	sentimentScore: number;
	ticker: string;
}

function BuzzCompareBars({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<BarChart
				data={data}
				layout="vertical"
				margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
			>
				<XAxis
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					type="number"
				/>
				<YAxis
					dataKey="label"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					type="category"
					width={Y_AXIS_WIDTH}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					cursor={{ fill: "var(--muted)", opacity: 0.3 }}
					formatter={(value) => [formatNum(Number(value), BUZZ_DP), "热度"]}
				/>
				<Bar dataKey="buzzScore">
					{data.map((row) => (
						<Cell fill={sentimentColor(row.sentimentScore)} key={row.ticker} />
					))}
				</Bar>
			</BarChart>
		</ResponsiveContainer>
	);
}

function BullBearRow({ item }: { item: SentimentCompareData }) {
	return (
		<div className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs">
			<div className="flex min-w-0 items-center gap-1.5">
				<span className="truncate font-medium">{item.name || item.ticker}</span>
				<span className="shrink-0 text-muted-foreground">{item.ticker}</span>
			</div>
			<div className="flex shrink-0 items-center gap-2 tabular-nums">
				<span style={{ color: BULLISH_COLOR }}>
					看多 {formatNum(clampPct(item.bullishPct), BUZZ_DP)}%
				</span>
				<span style={{ color: BEARISH_COLOR }}>
					看空 {formatNum(clampPct(item.bearishPct), BUZZ_DP)}%
				</span>
			</div>
		</div>
	);
}

/** finance_sentiment_compare → 舆情对比, capped at MAX_RENDERED_ITEMS — this
 * renders inline in chat, not a full comparison table. */
export function SentimentCompare({ data }: { data: SentimentCompareData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	const chartData: ChartRow[] = visible.map((item) => ({
		buzzScore: item.buzzScore,
		label: item.name || item.ticker,
		sentimentScore: item.sentimentScore,
		ticker: item.ticker,
	}));
	return (
		<CardShell title="舆情对比">
			<BuzzCompareBars data={chartData} />
			<div className="flex flex-col gap-1.5">
				{visible.map((item) => (
					<BullBearRow item={item} key={item.ticker} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
