// apps/web/src/components/dashboard/summary-cards.tsx

import { Coins, Hash, Zap } from "lucide-react";
import { CENTS_PER_DOLLAR } from "./dashboard-constants";
import { SummaryCard } from "./summary-card";
import type { UsageSummary } from "./use-usage-data";

const MILLION = 1_000_000;
const THOUSAND = 1000;
const COST_DECIMAL_PLACES = 2;
const TOKEN_DECIMAL_PLACES = 1;

interface SummaryCardsProps {
	isPending: boolean;
	totals: UsageSummary["totals"];
}

function formatTokens(n: number): string {
	if (n >= MILLION) {
		return `${(n / MILLION).toFixed(TOKEN_DECIMAL_PLACES)}M`;
	}
	if (n >= THOUSAND) {
		return `${(n / THOUSAND).toFixed(TOKEN_DECIMAL_PLACES)}K`;
	}
	return n.toString();
}

function formatCost(costCents: number): string {
	return `$${(costCents / CENTS_PER_DOLLAR).toFixed(COST_DECIMAL_PLACES)}`;
}

export function SummaryCards({ isPending, totals }: SummaryCardsProps) {
	const totalTokens = totals.inputTokens + totals.outputTokens;
	return (
		<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<SummaryCard
				icon={Zap}
				isPending={isPending}
				label="Total Tokens"
				value={formatTokens(totalTokens)}
			/>
			<SummaryCard
				icon={Coins}
				isPending={isPending}
				label="Est. Cost"
				value={formatCost(totals.costCents)}
			/>
			<SummaryCard
				icon={Hash}
				isPending={isPending}
				label="Turns"
				value={String(totals.turns)}
			/>
			<SummaryCard
				icon={Coins}
				isPending={isPending}
				label="Input Tokens"
				value={formatTokens(totals.inputTokens)}
			/>
		</div>
	);
}
