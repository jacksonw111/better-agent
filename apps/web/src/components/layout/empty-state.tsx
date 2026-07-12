import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared empty-state block: replaces the dashboard/integrations/chat-grid
 * idioms that each hand-rolled the same centered icon+title+body layout.
 * `body`/`icon`/`action` are all optional so a bare dead-end (like the chat
 * agent grid) can render with just a title and a way out.
 */
export function EmptyState({
	action,
	body,
	icon: Icon,
	title,
}: {
	action?: ReactNode;
	body?: string;
	icon?: LucideIcon;
	title: string;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center text-muted-foreground">
			{Icon ? <Icon className="h-10 w-10 opacity-40" /> : null}
			<p className="font-medium text-base text-foreground">{title}</p>
			{body ? <p className="max-w-xs text-sm">{body}</p> : null}
			{action}
		</div>
	);
}
