import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { BotIcon, ShieldIcon } from "lucide-react";
import { useEffect } from "react";
import type {
	TurnUsageDetail,
	UsageUpdateDetail,
} from "./bridge-session-status";
import type {
	StatusSnapshotContextUsage,
	StatusSnapshotDetail,
} from "./bridge-status-snapshot";
import {
	clampPct,
	deriveContextPct,
	formatStatusContextUsage,
} from "./bridge-usage-format";
import { McpServerBadge } from "./session-status-header";
import { QuotaSection, StatusSectionHeader } from "./status-quota-section";
import { statusStats } from "./status-snapshot-panel";
import { usageStats } from "./turn-usage-panel";

// P3-T4: the usage modal — clicking the inline usage strip above the composer
// opens a Dialog assembling everything the session has already reported about
// cost/usage/status: the last turn's stat table (`turn_usage`), the live
// context window (`usage_update` / `status_snapshot.contextUsage`), the
// session-total stats + account quota + MCP servers from the last
// `status_snapshot`. Pure assembly — every data source is the same
// already-parsed detail the inline chips render; opening merely fires one
// `getStatus` so the snapshot half is fresh. Capability-agnostic: each
// section self-omits when its data never arrived.

/** The shared label-over-value stat grid — same visual as the inline
 * `turn_usage` chip, reused by the 本回合 and 会话统计 sections. */
function StatGrid({ stats }: { stats: { label: string; value: string }[] }) {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-2">
			{stats.map((stat) => (
				<div className="flex flex-col" key={stat.label}>
					<span className="text-muted-foreground text-xs uppercase tracking-wide">
						{stat.label}
					</span>
					<span className="font-medium text-sm tabular-nums">{stat.value}</span>
				</div>
			))}
		</div>
	);
}

/** 本回合 — the last completed turn's cost/token/duration table, straight from
 * `turn_usage` via the same `usageStats` flattening the inline chip uses. */
function TurnSection({ detail }: { detail: TurnUsageDetail | null }) {
	if (!detail) {
		return null;
	}
	const stats = usageStats(detail);
	if (stats.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-2">
			<StatusSectionHeader title="本回合" />
			<StatGrid stats={stats} />
		</section>
	);
}

/** The freshest context-window figures: opencode's streamed `usage_update`
 * wins when it carried both counts (same priority as `deriveContextPct`),
 * falling back to the last snapshot's `contextUsage`. */
function contextUsageFor(
	usageUpdate: UsageUpdateDetail | null,
	statusSnapshot: StatusSnapshotDetail | null
): StatusSnapshotContextUsage | undefined {
	if (usageUpdate?.used !== undefined && usageUpdate.size !== undefined) {
		return { size: usageUpdate.size, used: usageUpdate.used };
	}
	return statusSnapshot?.contextUsage;
}

/** 上下文 — used/size + percent line with the same fill bar the Status
 * popover's context row uses (fill = consumed). */
function ContextSection({
	statusSnapshot,
	usageUpdate,
}: {
	statusSnapshot: StatusSnapshotDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}) {
	const usage = contextUsageFor(usageUpdate, statusSnapshot);
	const line = usage === undefined ? null : formatStatusContextUsage(usage);
	const pct = deriveContextPct(usageUpdate, statusSnapshot);
	if (line === null && pct === null) {
		return null;
	}
	return (
		<section className="flex flex-col gap-1.5">
			<StatusSectionHeader title="上下文" />
			{line !== null && (
				<span className="text-muted-foreground text-xs tabular-nums">
					{line}
				</span>
			)}
			{pct !== null && (
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary"
						style={{ width: `${clampPct(pct)}%` }}
					/>
				</div>
			)}
		</section>
	);
}

/** 会话统计 — the snapshot's model/permission meta plus its session-total
 * cost/token table (same `statusStats` flattening as the Status popover). */
function SessionStatsSection({
	detail,
}: {
	detail: StatusSnapshotDetail | null;
}) {
	if (!detail) {
		return null;
	}
	const stats = statusStats(detail);
	const hasMeta = Boolean(detail.model || detail.permissionMode);
	if (!hasMeta && stats.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-2">
			<StatusSectionHeader title="会话统计" />
			{hasMeta && (
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
				</div>
			)}
			{stats.length > 0 && <StatGrid stats={stats} />}
		</section>
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
		<section className="flex flex-col gap-1.5">
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
		</section>
	);
}

export interface UsageModalProps {
	/** Requests a fresh `status_snapshot` — fired once each time the modal
	 * opens; the reply lands in `statusSnapshot` asynchronously. */
	getStatus: () => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	statusSnapshot: StatusSnapshotDetail | null;
	turnUsage: TurnUsageDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}

/** The 用量 Dialog body: every section self-omits when its data never
 * arrived, and the whole thing degrades to one muted line when NOTHING has. */
function UsageModalBody({
	statusSnapshot,
	turnUsage,
	usageUpdate,
}: Pick<UsageModalProps, "statusSnapshot" | "turnUsage" | "usageUpdate">) {
	if (!(turnUsage || usageUpdate || statusSnapshot)) {
		return (
			<p className="text-muted-foreground text-xs">
				暂无数据 — 等待会话上报用量。
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-4">
			<TurnSection detail={turnUsage} />
			<ContextSection
				statusSnapshot={statusSnapshot}
				usageUpdate={usageUpdate}
			/>
			<SessionStatsSection detail={statusSnapshot} />
			<QuotaSection quota={statusSnapshot?.quota} />
			<McpSection servers={statusSnapshot?.mcpServers} />
		</div>
	);
}

export function UsageModal({
	getStatus,
	onOpenChange,
	open,
	statusSnapshot,
	turnUsage,
	usageUpdate,
}: UsageModalProps) {
	useEffect(() => {
		if (!open) {
			return;
		}
		// Best-effort refresh: the modal renders whatever's already cached, and
		// the snapshot reply (if any) streams in through `statusSnapshot`.
		getStatus().catch(() => undefined);
	}, [open, getStatus]);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>用量</DialogTitle>
				</DialogHeader>
				<UsageModalBody
					statusSnapshot={statusSnapshot}
					turnUsage={turnUsage}
					usageUpdate={usageUpdate}
				/>
			</DialogContent>
		</Dialog>
	);
}

// `TerminalUsageStrip` — the clickable strip that opens this modal — lives in
// usage-strip.tsx, split out purely to keep this file under the repo's
// max-lines-per-file gate.
