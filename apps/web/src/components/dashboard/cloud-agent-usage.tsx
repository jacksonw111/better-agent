import { Skeleton } from "@better-agent/ui/components/skeleton";
import { BotIcon } from "lucide-react";
import {
	formatCostUsd,
	formatTokenCount,
} from "@/components/bridge/bridge-usage-format";
import type { CloudAgentUsageRow } from "@/utils/api-types";
import type { WindowDays } from "./dashboard-constants";
import { useCloudAgentUsage } from "./use-cloud-agent-usage";

const skelKey = (i: number) => `sk${i}`;
const SKELETON_ROWS = 3;

// Cycling accent palette for agent rows. Local Agents can color by kind (a
// fixed enum); cloud agents are a dynamic per-user set, so each row is
// colored by its position in the (cost-sorted) list instead.
const ROW_COLORS = [
	"#d97757",
	"#3b82f6",
	"#f59e0b",
	"#a78bfa",
	"#10b981",
	"#ec4899",
];

function rowColor(index: number): string {
	return ROW_COLORS[index % ROW_COLORS.length] ?? "#64748b";
}

interface AgentRowProps {
	color: string;
	maxCost: number;
	row: CloudAgentUsageRow;
	totalCost: number;
}

function AgentRow({ color, maxCost, row, totalCost }: AgentRowProps) {
	const totalTokens = row.inputTokens + row.outputTokens;
	const costPct = totalCost > 0 ? (row.costUsd / totalCost) * 100 : 0;
	const barWidth = maxCost > 0 ? (row.costUsd / maxCost) * 100 : 0;
	return (
		<div className="flex flex-col gap-1.5 py-2">
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span
						className="flex size-6 shrink-0 items-center justify-center rounded-md"
						style={{ backgroundColor: `${color}20` }}
					>
						<BotIcon aria-hidden className="size-3.5" style={{ color }} />
					</span>
					<span className="truncate font-medium text-sm">{row.name}</span>
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
			{Array.from({ length: SKELETON_ROWS }, (_, i) => (
				<Skeleton className="h-14 w-full rounded-lg" key={skelKey(i)} />
			))}
		</div>
	);
}

function UsageEmpty() {
	return (
		<p className="py-4 text-muted-foreground text-sm">
			No cloud agent usage yet. Start a chat with an agent to see its cost and
			tokens.
		</p>
	);
}

interface CloudAgentUsageBodyProps {
	isEmpty: boolean;
	isPending: boolean;
	rows: CloudAgentUsageRow[];
}

function CloudAgentUsageBody({
	isEmpty,
	isPending,
	rows,
}: CloudAgentUsageBodyProps) {
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
			{sorted.map((row, index) => (
				<AgentRow
					color={rowColor(index)}
					key={row.agentId}
					maxCost={maxCost}
					row={row}
					totalCost={totalCost}
				/>
			))}
		</div>
	);
}

/** Presentational Cloud Agents breakdown — one row per cloud agent with its
 * cost, token total, and turn count. Split from the container so it renders
 * in tests without the query layer. Cloud counterpart of `UsageOverview`
 * (Local Agents' "Agent Breakdown" card). */
export function CloudAgentUsageView(props: CloudAgentUsageBodyProps) {
	return (
		<div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
			<p className="mb-2 font-medium text-sm">Cloud Agents</p>
			<CloudAgentUsageBody {...props} />
		</div>
	);
}

export function CloudAgentUsage({ windowDays }: { windowDays: WindowDays }) {
	const { isEmpty, isPending, rows } = useCloudAgentUsage(windowDays);
	return (
		<CloudAgentUsageView isEmpty={isEmpty} isPending={isPending} rows={rows} />
	);
}
