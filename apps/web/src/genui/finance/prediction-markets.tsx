import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type {
	PredictionMarketData,
	PredictionOutcomeData,
} from "./finance-schemas-fe9";
import { formatCompact, formatDate } from "./format";
import { CardShell } from "./primitives";

// finance_prediction_markets → Polymarket-style odds cards: one card per
// market, each outcome rendered as a labeled probability bar. A fixed accent
// color (rather than 红涨绿跌) since a probability isn't a signed change.

const PROBABILITY_PCT_MULTIPLIER = 100;
const PROBABILITY_DP = 1;
const MIN_PROBABILITY = 0;
const MAX_PROBABILITY = 1;
const BAR_ACCENT_COLOR = "#10b981"; // emerald — readable on both light/dark card backgrounds

function clampProbability(probability: number): number {
	return Math.min(Math.max(probability, MIN_PROBABILITY), MAX_PROBABILITY);
}

function formatProbabilityPct(probability: number): string {
	return `${(probability * PROBABILITY_PCT_MULTIPLIER).toFixed(PROBABILITY_DP)}%`;
}

function outcomeKey(
	outcome: PredictionOutcomeData,
	marketId: string,
	index: number
): string {
	return outcome.name ? `${marketId}-${outcome.name}` : `${marketId}-${index}`;
}

/** Small pulsing dot marking an outcome whose price streams from a live feed
 * rather than a periodic snapshot — a glanceable "实时" cue, not another
 * label to read. */
function LiveIndicator() {
	return (
		<span
			aria-label="实时"
			className="relative flex h-2 w-2 shrink-0"
			role="status"
			title="实时"
		>
			<span
				className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
				style={{ backgroundColor: BAR_ACCENT_COLOR }}
			/>
			<span
				className="relative inline-flex h-2 w-2 rounded-full"
				style={{ backgroundColor: BAR_ACCENT_COLOR }}
			/>
		</span>
	);
}

function OutcomeBar({ outcome }: { outcome: PredictionOutcomeData }) {
	const widthPct =
		clampProbability(outcome.probability) * PROBABILITY_PCT_MULTIPLIER;
	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 truncate text-muted-foreground text-xs">
				{outcome.name || "—"}
			</span>
			<div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full"
					style={{ backgroundColor: BAR_ACCENT_COLOR, width: `${widthPct}%` }}
				/>
			</div>
			{outcome.livePrice ? <LiveIndicator /> : null}
			<span className="w-12 shrink-0 text-right font-medium text-xs tabular-nums">
				{formatProbabilityPct(outcome.probability)}
			</span>
		</div>
	);
}

function marketKey(market: PredictionMarketData): string {
	return market.id || market.slug || market.question;
}

function MarketCard({ market }: { market: PredictionMarketData }) {
	const id = marketKey(market);
	return (
		<div className="flex flex-col gap-2 py-2">
			<p className="font-semibold text-sm">{market.question || "—"}</p>
			{market.outcomes.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					{market.outcomes.map((outcome, index) => (
						<OutcomeBar
							key={outcomeKey(outcome, id, index)}
							outcome={outcome}
						/>
					))}
				</div>
			) : null}
			<p className="text-muted-foreground text-xs">
				成交量 {formatCompact(market.volumeUsd)} · 截止{" "}
				{formatDate(market.endDate)}
			</p>
		</div>
	);
}

/** finance_prediction_markets → Polymarket odds cards, capped at
 * MAX_RENDERED_ITEMS — this renders inline in chat, not a full market
 * browser. */
export function PredictionMarkets({
	markets,
}: {
	markets: PredictionMarketData[];
}) {
	if (markets.length === 0) {
		return null;
	}
	const visible = markets.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = markets.length - visible.length;
	return (
		<CardShell title="预测市场 · Polymarket">
			<div className="flex flex-col divide-y">
				{visible.map((market) => (
					<MarketCard key={marketKey(market)} market={market} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
