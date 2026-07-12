// apps/web/src/components/dashboard/summary-card.tsx

import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { LucideIcon } from "lucide-react";

interface SummaryCardProps {
	icon: LucideIcon;
	isPending: boolean;
	label: string;
	value: string;
}

export function SummaryCard({
	icon: Icon,
	isPending,
	label,
	value,
}: SummaryCardProps) {
	return (
		<div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
			<div className="flex items-center justify-between">
				<span className="font-medium text-muted-foreground text-sm">
					{label}
				</span>
				<Icon className="h-4 w-4 text-muted-foreground" />
			</div>
			{isPending ? (
				<Skeleton className="h-7 w-24" />
			) : (
				<span className="font-bold text-2xl tabular-nums">{value}</span>
			)}
		</div>
	);
}
