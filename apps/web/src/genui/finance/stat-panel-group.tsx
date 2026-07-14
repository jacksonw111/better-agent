import type { ReactNode } from "react";
import { StatGrid } from "./primitives";
import type { StatPanelGroup } from "./stat-panel-types";

/** `items` renders as a `StatGrid`; otherwise fall back to free-form
 * `content` (RSI meter, a ProportionBar, paragraphs) or nothing. */
function GroupBody({ group }: { group: StatPanelGroup }): ReactNode {
	if (group.items) {
		return <StatGrid cols={group.cols} items={group.items} />;
	}
	return group.content ?? null;
}

/** One StatPanel section (design doc §8.11): an optional uppercase label
 * over its body. The lead group (no `label`) sits flush under the
 * `CardShell` header; every later group gets top padding to separate it
 * from the one above — same visual rhythm as the old per-card `Section`
 * helpers (technical-panel.tsx's MACD/KDJ/BOLL blocks) this replaces. */
export function StatPanelGroupView({ group }: { group: StatPanelGroup }) {
	if (!group.label) {
		return (
			<div className="flex flex-col gap-1.5">
				<GroupBody group={group} />
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-1.5 pt-1">
			<span className="text-muted-foreground text-xs uppercase tracking-wide">
				{group.label}
			</span>
			<GroupBody group={group} />
		</div>
	);
}
