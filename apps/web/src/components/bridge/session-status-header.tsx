import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import { BotIcon, FolderIcon, ServerIcon, ShieldIcon } from "lucide-react";
import type { SessionReadyDetail } from "./bridge-session-status";
import { truncateCwd } from "./bridge-usage-format";

const MCP_OK_STATUSES = new Set(["connected", "ready", "ok"]);
const MCP_ERROR_STATUSES = new Set(["failed", "error", "needs-auth"]);

/** Green once connected, red on a known failure state, amber for anything
 * else (pending/connecting/an unrecognized status string) — matches the
 * live/connecting/polling dot pattern already used by `TerminalStatus`. */
function mcpDotClass(status: string): string {
	const normalized = status.toLowerCase();
	if (MCP_ERROR_STATUSES.has(normalized)) {
		return "bg-destructive";
	}
	if (MCP_OK_STATUSES.has(normalized)) {
		return "bg-emerald-500";
	}
	return "bg-amber-500 animate-pulse";
}

/** One MCP server's status pill: a status-colored dot (see `mcpDotClass`)
 * plus its name, title-tipped with the raw status string. Shared by the
 * session-ready header and the on-demand status panel
 * (status-snapshot-panel.tsx) — the one visual language for an MCP server's
 * connection state across the bridge UI. */
export function McpServerBadge({
	name,
	status,
}: {
	name: string;
	status: string;
}) {
	return (
		<Badge title={`${name}: ${status}`} variant="outline">
			<span
				aria-hidden
				className={cn("size-1.5 rounded-full", mcpDotClass(status))}
			/>
			{name}
		</Badge>
	);
}

/** "42 tools · 12 commands · 3 skills" — omits any capability whose list
 * wasn't reported at all, so an adapter that doesn't yet surface e.g. skills
 * doesn't render a misleading "0 skills". */
function capabilitySummary(detail: SessionReadyDetail): string | null {
	const parts: string[] = [];
	if (detail.tools) {
		parts.push(`${detail.tools.length} tools`);
	}
	if (detail.slashCommands) {
		parts.push(`${detail.slashCommands.length} commands`);
	}
	if (detail.skills) {
		parts.push(`${detail.skills.length} skills`);
	}
	return parts.length > 0 ? parts.join(" · ") : null;
}

export interface SessionStatusHeaderProps {
	/** The latest `session_ready` detail, or `null` before the CLI's session
	 * has initialized (or if the session never sends one). Renders nothing in
	 * that case — this is enrichment, not a required chrome element. */
	detail: SessionReadyDetail | null;
}

/**
 * Compact capability header for a Local Agent session: model, permission
 * mode, cwd, tool/command/skill counts, and one status-dotted badge per MCP
 * server. Sourced from the curated `session_ready` status event (see
 * bridge-session-status.ts) — never rendered as a chat row, this is the
 * dedicated metadata surface for it. Wraps freely so it stays readable on
 * narrow viewports.
 */
export function SessionStatusHeader({ detail }: SessionStatusHeaderProps) {
	if (!detail) {
		return null;
	}
	const summary = capabilitySummary(detail);
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
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
			{detail.cwd && (
				<span className="flex min-w-0 items-center gap-1" title={detail.cwd}>
					<FolderIcon className="size-3.5 shrink-0" />
					<span className="truncate">{truncateCwd(detail.cwd)}</span>
				</span>
			)}
			{summary && <span>{summary}</span>}
			{detail.mcpServers && detail.mcpServers.length > 0 && (
				<span className="flex flex-wrap items-center gap-1">
					<ServerIcon className="size-3.5 shrink-0" />
					{detail.mcpServers.map((server) => (
						<McpServerBadge
							key={server.name}
							name={server.name}
							status={server.status}
						/>
					))}
				</span>
			)}
		</div>
	);
}
