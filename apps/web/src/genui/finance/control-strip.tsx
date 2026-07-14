import { cn } from "@better-agent/ui/lib/utils";
import type { ReactNode } from "react";

// Phase 0 Task E — `ControlStrip`, the ONE place every interactive finance
// card puts its controls (design doc §3 "统一 Control Strip"). Sits directly
// under a `CardShell` header. Left slot = the primary `Segmented` (Period or
// Pivot); right slot = the `Chip` group (Series/Filter). Sort lives in table
// headers, never here (§3 "Sort 指示器只活在表头"). A read-only card that has
// neither slot renders no strip at all (§3).

export interface ControlStripProps {
	/** Right slot: Series/Filter chips. Scrolls horizontally on narrow width
	 * instead of wrapping or squeezing (spec §7). */
	chips?: ReactNode;
	className?: string;
	/** Left slot: the archetype's primary segmented control (Period/Pivot). */
	primary?: ReactNode;
}

/** The layout shell per spec §3's ASCII diagram: `[primary]  [chips →]` in a
 * single row, 8pt-spaced, borderless. Returns `null` when both slots are
 * empty so a read-only card (SignalCard/OddsBars) renders no strip. */
export function ControlStrip({ className, chips, primary }: ControlStripProps) {
	if (!(primary || chips)) {
		return null;
	}

	return (
		<div
			className={cn(
				// flex-wrap so on a narrow card the chip group drops to its own
				// line (and scrolls there) instead of being squeezed/clipped off
				// the right edge behind the primary segmented control (mobile bug).
				"flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2",
				className
			)}
		>
			{primary ? <div className="shrink-0">{primary}</div> : null}
			{chips ? (
				<div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto">
					{chips}
				</div>
			) : null}
		</div>
	);
}
