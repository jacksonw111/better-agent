import { Skeleton } from "@better-agent/ui/components/skeleton";

import {
	formatCostUsd,
	formatTokenCount,
} from "@/components/bridge/bridge-usage-format";
import {
	AGENT_KIND_LABEL,
	AgentKindIcon,
} from "@/components/bridge/local-agent-kind-icon";
import type { LocalAgentUsageRow } from "@/utils/api-types";
import type { WindowDays } from "./dashboard-constants";
import { useLocalAgentUsage } from "./use-local-agent-usage";

const skelKey = (i: number) => `sk${i}`;

// Per-agent-kind colors — mirrors TokenTracker's PROVIDER_COLORS mapping.
const KIND_COLORS: Record<string, string> = {
	"claude-code": "#d97757",
	codex: "#3b82f6",
	opencode: "#f59e0b",
	pi: "#a78bfa",
};

function kindColor(kind: string): string {
	return KIND_COLORS[kind] ?? "#64748b";
}

interface AgentRowProps {
	maxCost: number;
	row: LocalAgentUsageRow;
	totalCost: number;
}

function AgentRow({ maxCost, row, totalCost }: AgentRowProps) {
	const totalTokens = row.inputTokens + row.outputTokens;
	const costPct = totalCost > 0 ? (row.costUsd / totalCost) * 100 : 0;
	const barWidth = maxCost > 0 ? (row.costUsd / maxCost) * 100 : 0;
	const color = kindColor(row.agentKind);
	return (
		<div className="flex flex-col gap-1.5 py-2">
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span
						className="flex size-6 shrink-0 items-center justify-center rounded-md"
						style={{ backgroundColor: `${color}20` }}
					>
						<AgentKindIcon className="size-3.5" kind={row.agentKind} />
					</span>
					<span className="truncate font-medium text-sm">
						{AGENT_KIND_LABEL[row.agentKind]}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
					<span className="text-muted-foreground">
						{formatTokenCount(totalTokens)}
					</span>
					<span className="font-medium">{formatCostUsd(row.costUsd)}</span>
				</div>
			</div>
			<div className="h-2 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full transition-all duration-500"
					style={{ backgroundColor: color, width: `${barWidth}%` }}
				/>
			</div>
			<div className="flex justify-end text-muted-foreground text-xs">
				{costPct.toFixed(1)}% of cost · {row.turns} turns
			</div>
		</div>
	);
}

function UsageSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			{Array.from({ length: 4 }, (_, i) => (
				<Skeleton className="h-14 w-full rounded-lg" key={skelKey(i)} />
			))}
		</div>
	);
}

function UsageEmpty() {
	return (
		<p className="py-4 text-muted-foreground text-sm">
			No local agent usage yet. Connect a local agent to see its cost and
			tokens.
		</p>
	);
}

interface UsageOverviewBodyProps {
	isEmpty: boolean;
	isPending: boolean;
	rows: LocalAgentUsageRow[];
}

function UsageOverviewBody({
	isEmpty,
	isPending,
	rows,
}: UsageOverviewBodyProps) {
	if (isPending) {
		return <UsageSkeleton />;
	}
	if (isEmpty) {
		return <UsageEmpty />;
	}
	const sorted = [...rows].sort((a, b) => b.costUsd - a.costUsd);
	const maxCost = Math.max(1, ...sorted.map((r) => r.costUsd));
	const totalCost = sorted.reduce((sum, r) => sum + r.costUsd, 0);
	return (
		<div className="divide-y divide-border">
			{sorted.map((row) => (
				<AgentRow
					key={row.agentKind}
					maxCost={maxCost}
					row={row}
					totalCost={totalCost}
				/>
			))}
		</div>
	);
}

export function UsageOverview({ windowDays }: { windowDays: WindowDays }) {
	const { isEmpty, isPending, rows } = useLocalAgentUsage(windowDays);
	return (
		<div className="rounded-xl border bg-card p-4 shadow-sm">
			<p className="mb-2 font-medium text-sm">Agent Breakdown</p>
			<UsageOverviewBody isEmpty={isEmpty} isPending={isPending} rows={rows} />
		</div>
	);
}
