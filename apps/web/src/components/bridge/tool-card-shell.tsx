import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { cn } from "@better-agent/ui/lib/utils";
import type { ReactNode } from "react";
import {
	HeaderChevron,
	HeaderDuration,
	StatusIcon,
} from "./activity-item-header";

// fix-tool-render-gaps: the borderless card chrome shared by the local-agent
// tool cards that aren't category-driven (MCP / WebFetch / WebSearch /
// ReportFindings). Same visual language as ActivityItem/BashCommandCard — a
// tinted rounded block, a status/duration/chevron header row — without the
// diff/primaryLine coupling those two carry.

/** The tinted, borderless outer block. Turns destructive-tinted on error, so a
 * failed call reads at a glance the same way the other terminal cards do. */
export function ToolCardShell({
	children,
	isError,
}: {
	children: ReactNode;
	isError?: boolean;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-md bg-muted/40 text-xs",
				isError && "bg-destructive/10"
			)}
		>
			{children}
		</div>
	);
}

/** The disclosure header row: icon + optional label chip + a truncating title,
 * with the shared status glyph, duration, and expand chevron on the right. The
 * button is disabled (no toggle) when there's no body to reveal. */
export function ToolCardHeaderRow({
	icon,
	label,
	title,
	tool,
	hasBody,
	open,
	onToggle,
}: {
	icon: ReactNode;
	label?: string;
	title: ReactNode;
	tool: ToolInvocation;
	hasBody: boolean;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			aria-expanded={hasBody ? open : undefined}
			className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
			disabled={!hasBody}
			onClick={onToggle}
			type="button"
		>
			{icon}
			{label ? (
				<span className="shrink-0 font-medium text-muted-foreground">
					{label}
				</span>
			) : null}
			<span className="min-w-0 flex-1 truncate font-mono text-foreground">
				{title}
			</span>
			<HeaderDuration durationMs={tool.durationMs} />
			<StatusIcon tool={tool} />
			<HeaderChevron hasBody={hasBody} open={open} />
		</button>
	);
}
