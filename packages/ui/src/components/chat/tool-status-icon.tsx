import { cn } from "@better-agent/ui/lib/utils";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import type { ToolInvocation } from "./chat-blocks";

// P1-T1: the one shared skeleton behind the two tool-status glyphs — the
// plain chat card (tool.tsx) and the local-agent terminal's ActivityItem
// header (apps/web/src/components/bridge/activity-item-header.tsx) render
// the same spinner/check/cross trio but with different accent colors, so the
// shape lives here and each caller keeps its own color mapping.

/** Per-status color overrides; an omitted status keeps the plain chat
 * card's muted defaults. */
export interface ToolStatusIconColors {
	complete?: string;
	running?: string;
}

export function ToolStatusIcon({
	status,
	colors,
}: {
	status: ToolInvocation["status"];
	colors?: ToolStatusIconColors;
}) {
	if (status === "running") {
		return (
			<Loader2Icon
				className={cn(
					"size-3.5 animate-spin",
					colors?.running ?? "text-muted-foreground"
				)}
			/>
		);
	}
	if (status === "error") {
		return <XIcon className="size-3.5 text-destructive" />;
	}
	return (
		<CheckIcon
			className={cn("size-3.5", colors?.complete ?? "text-muted-foreground")}
		/>
	);
}
