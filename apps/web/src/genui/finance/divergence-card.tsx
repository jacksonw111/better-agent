import { cn } from "@better-agent/ui/lib/utils";
import {
	AlertTriangle,
	ChevronDown,
	Lightbulb,
	type LucideIcon,
	Minus,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import {
	DOWN_COLOR,
	SENTIMENT_BEAR,
	SENTIMENT_BULL,
	UP_COLOR,
	VERDICT_BOTTOM_DIVERGENCE,
	VERDICT_TOP_DIVERGENCE,
} from "./chart-theme";
import type { DivergenceData, DivergenceSignal } from "./finance-schemas-fe11";
import { formatNum } from "./format";
import { EASE_OUT, TRANSITION_MS, useReducedMotion } from "./motion";
import { CardShell, ChangePct, StatGrid } from "./primitives";
import { useExpand } from "./use-expand";
import { VerdictPill } from "./verdict-pill";

// finance_divergence → price↔sentiment divergence signal card (§8.12
// SignalCard, I·E). This is a decision widget, not a data readout: `signal`
// carries the verdict computed upstream (顶背离/底背离/多头共振/空头共振/
// 中性/数据不足), surfaced via the shared `VerdictPill`. The headline pill +
// price↔sentiment compare + note stay always-visible; the raw-figure StatGrid
// sits behind Expand (E) since it restates what the compare already shows.
// Every color here is sourced from `chart-theme` — no locally redeclared hex.

const TREND_ICON_SIZE = 14;
const SENTIMENT_DP = 0;
const MS_PER_SECOND = 1000;
const EXPAND_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;
const STATS_EXPAND_ID = "stats";

interface SignalConfig {
	color: string | null;
	icon: LucideIcon;
	label: string;
}

// 多头共振/空头共振 reuse the price axis's UP_COLOR/DOWN_COLOR (红涨绿跌);
// only the two divergence verdicts get colors of their own (§5.2 verdict 色).
const SIGNAL_CONFIG: Record<DivergenceSignal, SignalConfig> = {
	顶背离: {
		color: VERDICT_TOP_DIVERGENCE,
		icon: AlertTriangle,
		label: "顶背离 · 价涨情弱",
	},
	底背离: {
		color: VERDICT_BOTTOM_DIVERGENCE,
		icon: Lightbulb,
		label: "底背离 · 价跌情稳",
	},
	多头共振: { color: UP_COLOR, icon: TrendingUp, label: "多头共振" },
	空头共振: { color: DOWN_COLOR, icon: TrendingDown, label: "空头共振" },
	中性: { color: null, icon: Minus, label: "中性" },
	数据不足: { color: null, icon: Minus, label: "数据不足" },
};

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

/** Price-direction trend arrow: 红涨绿跌, matching `ChangePct`'s convention —
 * colors sourced from chart-theme's price axis. */
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

/** Sentiment-direction trend arrow: emerald/rose (bullish/bearish), sourced
 * from chart-theme's sentiment axis — never the price axis's red/green (see
 * chart-theme's SENTIMENT_BULL/SENTIMENT_BEAR module comment). */
function SentimentTrendArrow({ trend }: { trend: string }) {
	if (isRisingTrend(trend)) {
		return (
			<TrendingUp
				className="shrink-0"
				color={SENTIMENT_BULL}
				size={TREND_ICON_SIZE}
			/>
		);
	}
	if (isFallingTrend(trend)) {
		return (
			<TrendingDown
				className="shrink-0"
				color={SENTIMENT_BEAR}
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
		<div className="flex flex-col gap-1.5">
			<span className="text-muted-foreground text-xs">{label}</span>
			<div className="flex items-center gap-1.5">{children}</div>
			<span className="text-muted-foreground text-xs">{footer}</span>
		</div>
	);
}

// Press-feedback scale (§6 "按压反馈") shares the `active:scale-[0.98]` token
// used by chip.tsx/segmented.tsx/quote-tile.tsx — kept on its own `cn()` line
// to match their existing formatting.
const TOGGLE_CLASS = cn(
	"flex w-fit items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground",
	"active:scale-[0.98]"
);

/** Expand affordance (E): reveals the raw-figure StatGrid behind the always-
 * visible headline + compare. Native `<button>` for free keyboard support. */
function StatDetailToggle({
	expanded,
	onToggle,
}: {
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			aria-expanded={expanded}
			className={TOGGLE_CLASS}
			onClick={onToggle}
			type="button"
		>
			{expanded ? "收起明细" : "展开明细"}
			<ChevronDown
				className={cn("transition-transform", expanded && "rotate-180")}
				size={TREND_ICON_SIZE}
			/>
		</button>
	);
}

/** Raw-figure detail behind Expand: a plain opacity crossfade (§6 "行展开
 * crossfade"), reduced-motion snaps instantly. */
function StatDetailPanel({
	data,
	reduced,
}: {
	data: DivergenceData;
	reduced: boolean;
}) {
	return (
		<motion.div
			animate={{ opacity: 1 }}
			initial={reduced ? false : { opacity: 0 }}
			transition={
				reduced
					? { duration: 0 }
					: { duration: EXPAND_FADE_SECONDS, ease: EASE_OUT }
			}
		>
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
		</motion.div>
	);
}

/** finance_divergence → price↔sentiment divergence signal card: a headline
 * `VerdictPill`, a two-column 价格 vs 舆情 comparison, the upstream `note`
 * explaining the verdict — all always-visible — and the raw-figure StatGrid
 * behind Expand. */
export function DivergenceCard({ data }: { data: DivergenceData }) {
	const reduced = useReducedMotion() ?? false;
	const expand = useExpand();
	const expanded = expand.isExpanded(STATS_EXPAND_ID);
	const config = SIGNAL_CONFIG[data.signal];

	return (
		<CardShell title={`${data.ticker} · 价格↔舆情`}>
			<VerdictPill
				color={config.color}
				icon={config.icon}
				label={config.label}
			/>
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
			<StatDetailToggle
				expanded={expanded}
				onToggle={() => expand.toggle(STATS_EXPAND_ID)}
			/>
			{expanded ? <StatDetailPanel data={data} reduced={reduced} /> : null}
		</CardShell>
	);
}
