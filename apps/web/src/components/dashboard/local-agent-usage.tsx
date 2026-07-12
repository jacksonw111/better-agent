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

interface LocalAgentUsageViewProps {
	isEmpty: boolean;
	isPending: boolean;
	rows: LocalAgentUsageRow[];
}

function UsageStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col items-end">
			<span className="font-semibold text-sm tabular-nums">{value}</span>
			<span className="text-muted-foreground text-xs">{label}</span>
		</div>
	);
}

function UsageRowCard({ row }: { row: LocalAgentUsageRow }) {
	const totalTokens = row.inputTokens + row.outputTokens;
	const statsClass =
		row.turns === 0
			? "flex items-center gap-4 text-muted-foreground"
			: "flex items-center gap-4";
	return (
		<div className="flex items-center justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10">
			<div className="flex items-center gap-3">
				<div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<AgentKindIcon className="size-4" kind={row.agentKind} />
				</div>
				<span className="font-medium text-sm">
					{AGENT_KIND_LABEL[row.agentKind]}
				</span>
			</div>
			<div className={statsClass}>
				<UsageStat label="Cost" value={formatCostUsd(row.costUsd)} />
				<UsageStat label="Tokens" value={formatTokenCount(totalTokens)} />
				<UsageStat label="Turns" value={String(row.turns)} />
			</div>
		</div>
	);
}

const SKELETON_KEYS = ["s0", "s1", "s2", "s3"];

function UsageSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			{SKELETON_KEYS.map((key) => (
				<Skeleton className="h-20 w-full rounded-lg" key={key} />
			))}
		</div>
	);
}

function UsageEmpty() {
	return (
		<p className="text-muted-foreground text-sm">
			No local agent usage yet. Connect a local agent to see its cost and tokens
			here.
		</p>
	);
}

function UsageBody({ isEmpty, isPending, rows }: LocalAgentUsageViewProps) {
	if (isPending) {
		return <UsageSkeleton />;
	}
	if (isEmpty) {
		return <UsageEmpty />;
	}
	return (
		<div className="flex flex-col gap-3">
			{rows.map((row) => (
				<UsageRowCard key={row.agentKind} row={row} />
			))}
		</div>
	);
}

/** Presentational Local Agents breakdown — one row per agent kind with its
 * cost, token total, and turn count. Split from the container so it renders in
 * tests without the query layer. */
export function LocalAgentUsageView(props: LocalAgentUsageViewProps) {
	return (
		<section className="flex flex-col gap-4">
			<h2 className="font-semibold text-base">Local Agents</h2>
			<UsageBody {...props} />
		</section>
	);
}

export function LocalAgentUsage({ windowDays }: { windowDays: WindowDays }) {
	const { isEmpty, isPending, rows } = useLocalAgentUsage(windowDays);
	return (
		<LocalAgentUsageView isEmpty={isEmpty} isPending={isPending} rows={rows} />
	);
}
