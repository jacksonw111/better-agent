import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { cn } from "@better-agent/ui/lib/utils";
import {
	BotIcon,
	GaugeIcon,
	Loader2Icon,
	RefreshCwIcon,
	ShieldIcon,
} from "lucide-react";
import { useState } from "react";
import type { StatusSnapshotDetail } from "./bridge-status-snapshot";
import {
	clampPct,
	formatCostUsd,
	formatStatusContextUsage,
	formatTokenCount,
} from "./bridge-usage-format";
import { McpServerBadge } from "./session-status-header";
import { QuotaSection, StatusSectionHeader } from "./status-quota-section";

// The detail page's on-demand status panel: a "Status" trigger next to "Past
// conversations" (see terminal-header.tsx) that asks the CLI adapter for its
// current model/context/cost/tokens/mcp/running snapshot (`{ control:
// getStatus }`, answered as a `status_snapshot` status event — see
// use-bridge-terminal.ts) and renders whatever's arrived, mirroring
// PastConversations's popover-on-open pattern.

interface StatusStat {
	label: string;
	value: string;
}

function tokenStat(count: number | undefined): string | undefined {
	return count === undefined ? undefined : formatTokenCount(count);
}

/** Flattens a `status_snapshot`'s cost/token fields into the labeled stats the
 * panel shows, dropping any figure the agent didn't report — same "table of
 * candidates, filter to defined" shape as `turn-usage-panel.tsx`'s
 * `usageStats`. */
function statusStats(detail: StatusSnapshotDetail): StatusStat[] {
	const tokens = detail.tokens;
	const candidates: [string, string | undefined][] = [
		[
			"Cost",
			detail.costUsd === undefined ? undefined : formatCostUsd(detail.costUsd),
		],
		["Input", tokenStat(tokens?.input)],
		["Output", tokenStat(tokens?.output)],
		["Cache read", tokenStat(tokens?.cacheRead)],
		["Cache write", tokenStat(tokens?.cacheWrite)],
	];
	const stats: StatusStat[] = [];
	for (const [label, value] of candidates) {
		if (value !== undefined) {
			stats.push({ label, value });
		}
	}
	return stats;
}

function ContextUsageRow({
	usage,
}: {
	usage: StatusSnapshotDetail["contextUsage"];
}) {
	if (!usage) {
		return null;
	}
	const line = formatStatusContextUsage(usage);
	if (line === null) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs tabular-nums">{line}</span>
			{usage.pct !== undefined && (
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary"
						style={{ width: `${clampPct(usage.pct)}%` }}
					/>
				</div>
			)}
		</div>
	);
}

function RunningIndicator({ running }: { running: boolean | undefined }) {
	if (running === undefined) {
		return null;
	}
	return (
		<span className="flex items-center gap-1.5">
			<span
				aria-hidden
				className={cn(
					"size-1.5 rounded-full",
					running ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/50"
				)}
			/>
			{running ? "Running" : "Idle"}
		</span>
	);
}

function StatusMetaRow({ detail }: { detail: StatusSnapshotDetail }) {
	if (
		!(detail.model || detail.permissionMode) &&
		detail.running === undefined
	) {
		return null;
	}
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
			{detail.model && (
				<span className="flex items-center gap-1">
					<BotIcon className="size-3.5 shrink-0" />
					{detail.model}
				</span>
			)}
			{detail.permissionMode && (
				<span className="flex items-center gap-1">
					<ShieldIcon className="size-3.5 shrink-0" />
					{detail.permissionMode}
				</span>
			)}
			<RunningIndicator running={detail.running} />
		</div>
	);
}

/** "This session" section: the context-window bar (when reported) plus the
 * cost/token stat grid — everything scoped to THIS run, as opposed to the
 * account-wide `QuotaSection` above it. Renders nothing when neither has
 * anything to show, so a bare meta-only snapshot doesn't leave a dangling
 * empty-titled section. */
function SessionSection({ detail }: { detail: StatusSnapshotDetail }) {
	const stats = statusStats(detail);
	const hasContext =
		detail.contextUsage !== undefined &&
		formatStatusContextUsage(detail.contextUsage) !== null;
	if (!hasContext && stats.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			<StatusSectionHeader title="This session" />
			<ContextUsageRow usage={detail.contextUsage} />
			{stats.length > 0 && (
				<div className="flex flex-wrap gap-x-4 gap-y-2">
					{stats.map((stat) => (
						<div className="flex flex-col" key={stat.label}>
							<span className="text-muted-foreground text-xs uppercase tracking-wide">
								{stat.label}
							</span>
							<span className="font-medium text-sm tabular-nums">
								{stat.value}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function McpSection({
	servers,
}: {
	servers: StatusSnapshotDetail["mcpServers"];
}) {
	if (!servers || servers.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1.5">
			<StatusSectionHeader title="MCP" />
			<div className="flex flex-wrap items-center gap-1">
				{servers.map((server) => (
					<McpServerBadge
						key={server.name}
						name={server.name}
						status={server.status}
					/>
				))}
			</div>
		</div>
	);
}

function StatusSnapshotBody({
	detail,
	pending,
}: {
	detail: StatusSnapshotDetail | null;
	pending: boolean;
}) {
	if (!detail) {
		return (
			<p className="text-muted-foreground text-xs">
				{pending
					? "Asking the agent for its status…"
					: "No status yet — refresh to ask the agent."}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<StatusMetaRow detail={detail} />
			<QuotaSection quota={detail.quota} />
			<SessionSection detail={detail} />
			<McpSection servers={detail.mcpServers} />
		</div>
	);
}

export interface StatusSnapshotPanelProps {
	/** The latest `status_snapshot` detail, or `null` before a `getStatus`
	 * request has gotten a reply. */
	detail: StatusSnapshotDetail | null;
	/** Requests a fresh snapshot — fire-and-forget; the reply lands in `detail`
	 * asynchronously once the feed reflects it. */
	onRequestStatus: () => Promise<void>;
}

/**
 * The Local Agent detail page's "Status" button: on open (and via its own
 * refresh icon) asks the CLI adapter for its current on-demand status and
 * renders whatever's arrived as a small popover, always showing the LATEST
 * snapshot the session feed has seen. `pending` tracks only the in-flight
 * refresh request, not whether a snapshot has ever arrived, so a stale
 * snapshot stays visible (rather than flashing empty) while a newer one is
 * fetched.
 */
export function StatusSnapshotPanel({
	detail,
	onRequestStatus,
}: StatusSnapshotPanelProps) {
	const [pending, setPending] = useState(false);

	const refresh = async (): Promise<void> => {
		setPending(true);
		try {
			await onRequestStatus();
		} finally {
			setPending(false);
		}
	};

	return (
		<Popover
			onOpenChange={(next) => {
				if (next) {
					refresh();
				}
			}}
		>
			<PopoverTrigger
				render={<Button aria-label="Status" size="xs" variant="outline" />}
			>
				<GaugeIcon />
				Status
			</PopoverTrigger>
			<PopoverContent className="w-72 sm:w-80">
				<PopoverHeader className="flex-row items-center justify-between">
					<PopoverTitle>Status</PopoverTitle>
					<Button
						aria-label="Refresh status"
						disabled={pending}
						onClick={() => refresh()}
						size="icon-sm"
						variant="ghost"
					>
						{pending ? (
							<Loader2Icon className="size-3.5 animate-spin" />
						) : (
							<RefreshCwIcon className="size-3.5" />
						)}
					</Button>
				</PopoverHeader>
				<StatusSnapshotBody detail={detail} pending={pending} />
			</PopoverContent>
		</Popover>
	);
}
