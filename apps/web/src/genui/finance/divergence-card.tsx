import {
	AlertTriangle,
	Lightbulb,
	type LucideIcon,
	Minus,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DivergenceData, DivergenceSignal } from "./finance-schemas-fe11";
import { formatNum } from "./format";
import { CardShell, ChangePct, StatGrid } from "./primitives";

// finance_divergence → price↔sentiment divergence signal card. This is a
// decision widget, not a data readout: `signal` carries the verdict computed
// upstream (顶背离/底背离/多头共振/空头共振/中性/数据不足), and this
// component's whole job is to make that verdict legible at a glance via a
// colored badge, then back it up with a price-vs-sentiment comparison and
// the raw numbers.

const UP_COLOR = "#ef4444"; // 红涨 — price direction only
const DOWN_COLOR = "#16a34a"; // 绿跌 — price direction only
const BULLISH_COLOR = "#10b981"; // emerald — sentiment direction only, never
// reuse the price 红涨绿跌 colors for sentiment: bullish/bearish buzz is a
// distinct axis from price direction (see sentiment-trending.tsx).
const BEARISH_COLOR = "#f43f5e"; // rose — sentiment direction only
const AMBER = "#f59e0b"; // 顶背离 — caution
const BLUE = "#3b82f6"; // 底背离 — opportunity

const BADGE_ICON_SIZE = 18;
const TREND_ICON_SIZE = 14;
const SENTIMENT_DP = 0;
const BADGE_BG_ALPHA = "1a"; // ~10% opacity hex suffix
const BADGE_BORDER_ALPHA = "40"; // ~25% opacity hex suffix

interface SignalConfig {
	color: string | null;
	icon: LucideIcon;
	label: string;
}

const SIGNAL_CONFIG: Record<DivergenceSignal, SignalConfig> = {
	顶背离: { color: AMBER, icon: AlertTriangle, label: "顶背离 · 价涨情弱" },
	底背离: { color: BLUE, icon: Lightbulb, label: "底背离 · 价跌情稳" },
	多头共振: { color: UP_COLOR, icon: TrendingUp, label: "多头共振" },
	空头共振: { color: DOWN_COLOR, icon: TrendingDown, label: "空头共振" },
	中性: { color: null, icon: Minus, label: "中性" },
	数据不足: { color: null, icon: Minus, label: "数据不足" },
};

/** The at-a-glance verdict: a colored pill with icon + label, sized to read
 * as the headline of the card rather than another stat among many. */
function SignalBadge({ signal }: { signal: DivergenceSignal }) {
	const config = SIGNAL_CONFIG[signal];
	const Icon = config.icon;
	return (
		<div
			className="flex w-fit items-center gap-2 rounded-lg border px-3 py-2"
			style={
				config.color
					? {
							backgroundColor: `${config.color}${BADGE_BG_ALPHA}`,
							borderColor: `${config.color}${BADGE_BORDER_ALPHA}`,
							color: config.color,
						}
					: undefined
			}
		>
			<Icon size={BADGE_ICON_SIZE} />
			<span className="font-semibold text-sm">{config.label}</span>
		</div>
	);
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

/** Price-direction trend arrow: 红涨绿跌, matching `ChangePct`'s convention. */
function PriceTrendArrow({ trend }: { trend: string }) {
	if (isRisingTrend(trend)) {
		return (
			<TrendingUp
				className="shrink-0"
				color={UP_COLOR}
				size={TREND_ICON_SIZE}
			/>
		);
	}
	if (isFallingTrend(trend)) {
		return (
			<TrendingDown
				className="shrink-0"
				color={DOWN_COLOR}
				size={TREND_ICON_SIZE}
			/>
		);
	}
	return (
		<Minus className="shrink-0 text-muted-foreground" size={TREND_ICON_SIZE} />
	);
}

/** Sentiment-direction trend arrow: emerald/rose (bullish/bearish), never
 * red/green — see the module comment on BULLISH_COLOR. */
function SentimentTrendArrow({ trend }: { trend: string }) {
	if (isRisingTrend(trend)) {
		return (
			<TrendingUp
				className="shrink-0"
				color={BULLISH_COLOR}
				size={TREND_ICON_SIZE}
			/>
		);
	}
	if (isFallingTrend(trend)) {
		return (
			<TrendingDown
				className="shrink-0"
				color={BEARISH_COLOR}
				size={TREND_ICON_SIZE}
			/>
		);
	}
	return (
		<Minus className="shrink-0 text-muted-foreground" size={TREND_ICON_SIZE} />
	);
}

function CompareColumn({
	label,
	children,
	footer,
}: {
	label: string;
	children: ReactNode;
	footer: string;
}) {
	return (
		<div className="flex flex-col gap-1.5 rounded-lg border p-3">
			<span className="text-muted-foreground text-xs">{label}</span>
			<div className="flex items-center gap-1.5">{children}</div>
			<span className="text-muted-foreground text-xs">{footer}</span>
		</div>
	);
}

/** finance_divergence → price↔sentiment divergence signal card: a headline
 * signal badge, a two-column 价格 vs 舆情 comparison, the upstream `note`
 * explaining the verdict, and a StatGrid of the raw figures. */
export function DivergenceCard({ data }: { data: DivergenceData }) {
	return (
		<CardShell title={`${data.ticker} · 价格↔舆情`}>
			<SignalBadge signal={data.signal} />
			<div className="grid grid-cols-2 gap-3">
				<CompareColumn footer="5日涨跌" label="价格">
					<ChangePct value={data.priceChange5d} />
					<PriceTrendArrow trend={data.priceTrend} />
				</CompareColumn>
				<CompareColumn
					footer={`热度 ${formatNum(data.buzzScore, SENTIMENT_DP)}`}
					label="舆情"
				>
					<ChangePct value={data.sentimentNet} />
					<SentimentTrendArrow trend={data.sentimentTrend} />
				</CompareColumn>
			</div>
			{data.note ? (
				<p className="text-muted-foreground text-xs">{data.note}</p>
			) : null}
			<StatGrid
				items={[
					{ label: "1日涨跌", value: <ChangePct value={data.priceChange1d} /> },
					{ label: "5日涨跌", value: <ChangePct value={data.priceChange5d} /> },
					{ label: "舆情热度", value: formatNum(data.buzzScore, SENTIMENT_DP) },
					{
						label: "情绪分",
						value: formatNum(data.sentimentScore, SENTIMENT_DP),
					},
					{ label: "看多%", value: formatNum(data.bullishPct, SENTIMENT_DP) },
					{ label: "看空%", value: formatNum(data.bearishPct, SENTIMENT_DP) },
				]}
			/>
		</CardShell>
	);
}
