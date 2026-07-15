import { useState } from "react";
import { TurnUsagePanel } from "./turn-usage-panel";
import { UsageModal, type UsageModalProps } from "./usage-modal";
import { UsageUpdateLine } from "./usage-update-line";

// P3-T4: the usage modal's trigger, split out of usage-modal.tsx purely to
// keep that file under the repo's max-lines-per-file gate.

export type TerminalUsageStripProps = Omit<
	UsageModalProps,
	"onOpenChange" | "open"
>;

/**
 * The clickable usage strip above the composer (P3-T4): the same inline
 * `turn_usage` grid / `usage_update` line as before, now wrapped in one button
 * (with a subtle right-aligned 用量详情 affordance) that opens `UsageModal`.
 * The trigger only appears once SOME usage detail has arrived — before that
 * there's nothing to summarize, so an empty click target would mislead.
 */
export function TerminalUsageStrip({
	getStatus,
	statusSnapshot,
	turnUsage,
	usageUpdate,
}: TerminalUsageStripProps) {
	const [open, setOpen] = useState(false);
	const hasStrip = turnUsage !== null || usageUpdate !== null;
	return (
		<div className="pb-3">
			{hasStrip && (
				<button
					aria-label="查看用量详情"
					className="group block w-full cursor-pointer text-left"
					onClick={() => setOpen(true)}
					type="button"
				>
					<TurnUsagePanel detail={turnUsage} />
					<UsageUpdateLine detail={usageUpdate} />
					<div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
						<span className="block text-right text-muted-foreground/60 text-xs transition-colors group-hover:text-muted-foreground">
							用量详情
						</span>
					</div>
				</button>
			)}
			<UsageModal
				getStatus={getStatus}
				onOpenChange={setOpen}
				open={open}
				statusSnapshot={statusSnapshot}
				turnUsage={turnUsage}
				usageUpdate={usageUpdate}
			/>
		</div>
	);
}
