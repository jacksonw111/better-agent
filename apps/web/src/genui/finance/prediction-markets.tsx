import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import { PROBABILITY } from "./chart-theme";
import type {
	PredictionMarketData,
	PredictionOutcomeData,
} from "./finance-schemas-fe9";
import { formatCompact, formatDate } from "./format";
import { CardShell } from "./primitives";
import { ProportionBar } from "./proportion-bar";
import { useSort } from "./use-sort";

// finance_prediction_markets → Polymarket-style odds cards: one card per
// market, each outcome rendered as a `ProportionBar` (§8.13 OddsBars, So·I —
// sorted most-likely-first, % always visible). Outcomes are sorted within
// their own market only; markets themselves keep source order.

const PROBABILITY_PCT_MULTIPLIER = 100;
const PROBABILITY_DP = 1;
const MAX_PROBABILITY = 1;

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
 * label to read. Color comes from the probability axis (`chart-theme`), the
 * same tone the bar itself uses. */
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
				style={{ backgroundColor: PROBABILITY }}
			/>
			<span
				className="relative inline-flex h-2 w-2 rounded-full"
				style={{ backgroundColor: PROBABILITY }}
			/>
		</span>
	);
}

/** One outcome's odds bar: `ProportionBar` (probability tone, single mode)
 * plus the live-feed dot appended after the bar+% when present. */
function OutcomeRow({ outcome }: { outcome: PredictionOutcomeData }) {
	return (
		<div className="flex items-center gap-2">
			<ProportionBar
				className="min-w-0 flex-1"
				label={outcome.name || "—"}
				max={MAX_PROBABILITY}
				tone="probability"
				value={outcome.probability}
				valueLabel={formatProbabilityPct(outcome.probability)}
			/>
			{outcome.livePrice ? <LiveIndicator /> : null}
		</div>
	);
}

function marketKey(market: PredictionMarketData): string {
	return market.id || market.slug || market.question;
}

/** Outcomes read most-likely-first (So): sorted descending by probability via
 * `useSort`, applied automatically — OddsBars is a readout card (§3: no
 * control strip), so there's no user-facing toggle, just the sorted order. */
function MarketCard({ market }: { market: PredictionMarketData }) {
	const id = marketKey(market);
	const { sorted } = useSort(market.outcomes, {
		initialKey: "probability",
		initialDir: "desc",
	});
	return (
		<div className="flex flex-col gap-2 py-2">
			<p className="font-semibold text-sm">{market.question || "—"}</p>
			{sorted.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					{sorted.map((outcome, index) => (
						<OutcomeRow
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
