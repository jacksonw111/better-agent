import { CENTS_PER_DOLLAR } from "./dashboard-constants";
import type { UsageSummary } from "./use-usage-data";

const MILLION = 1_000_000;
const THOUSAND = 1000;

interface StatsPanelProps {
	isPending: boolean;
	totals: UsageSummary["totals"];
}

function formatTokens(n: number): string {
	if (n >= MILLION) {
		return `${(n / MILLION).toFixed(1)}M`;
	}
	if (n >= THOUSAND) {
		return `${(n / THOUSAND).toFixed(1)}K`;
	}
	return String(n);
}

function formatCost(costCents: number): string {
	return `$${(costCents / CENTS_PER_DOLLAR).toFixed(2)}`;
}

function StatTile({
	isPending,
	label,
	sublabel,
	value,
}: {
	isPending: boolean;
	label: string;
	sublabel?: string;
	value: string;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-1 rounded-lg bg-muted/50 px-3 py-3">
			{isPending ? (
				<div className="h-7 w-20 animate-pulse rounded bg-muted" />
			) : (
				<span className="font-bold text-2xl tabular-nums">{value}</span>
			)}
			<span className="text-muted-foreground text-xs">{label}</span>
			{sublabel ? (
				<span className="text-muted-foreground/70 text-xs">{sublabel}</span>
			) : null}
		</div>
	);
}

export function StatsPanel({ isPending, totals }: StatsPanelProps) {
	const totalTokens = totals.inputTokens + totals.outputTokens;
	const avgCostPerTurn =
		totals.turns > 0 ? totals.costCents / totals.turns / CENTS_PER_DOLLAR : 0;
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<StatTile
				isPending={isPending}
				label="Total Cost"
				value={formatCost(totals.costCents)}
			/>
			<StatTile
				isPending={isPending}
				label="Total Tokens"
				value={formatTokens(totalTokens)}
			/>
			<StatTile
				isPending={isPending}
				label="Turns"
				value={String(totals.turns)}
			/>
			<StatTile
				isPending={isPending}
				label="Avg $/Turn"
				value={`$${avgCostPerTurn.toFixed(3)}`}
			/>
		</div>
	);
}
