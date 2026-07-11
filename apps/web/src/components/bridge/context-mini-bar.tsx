import { clampPct } from "./bridge-usage-format";

// R4-T2: the header's glanceable context-fill readout, split out of
// terminal-header.tsx purely to keep that file under the repo's 300-line cap.

/** A 32px-wide (`w-8`) micro progress bar + pct next to the Status trigger, so
 * a user can see how full the context window is getting WITHOUT opening the
 * Status popover. Sourced from `deriveContextPct` (bridge-usage-format.ts) —
 * whichever of the streamed `usage_update` or the last `status_snapshot` most
 * recently reported a context percentage; the caller renders this only when
 * that derivation succeeded, so there's no "unknown" state to handle here. */
export function ContextMiniBar({ pct }: { pct: number }) {
	const clamped = clampPct(pct);
	return (
		<span
			aria-label={`Context usage: ${clamped}%`}
			className="flex items-center gap-1"
			role="img"
		>
			<span className="h-1.5 w-8 overflow-hidden rounded-full bg-muted">
				<span
					className="block h-full rounded-full bg-primary"
					style={{ width: `${clamped}%` }}
				/>
			</span>
			<span className="text-muted-foreground text-xs tabular-nums">
				{clamped}%
			</span>
		</span>
	);
}
