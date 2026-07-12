import { cn } from "@better-agent/ui/lib/utils";
import type { DiffLine } from "./activity-diff";

// R1-T3: the inline colored diff a completed fileEdit ActivityItem shows
// instead of a raw output dump once a diff is known (see activity-diff.ts).

export function ActivityDiffView({ lines }: { lines: DiffLine[] }) {
	return (
		<div className="max-h-64 overflow-auto rounded-md bg-background/60 font-mono text-xs leading-relaxed">
			{lines.map((line, index) => (
				<div
					className={cn(
						"whitespace-pre-wrap break-words px-2",
						line.sign === "+" &&
							"bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
						line.sign === "-" && "bg-destructive/10 text-destructive",
						// R2-T3 review finding 3: the size-cap truncation marker — no
						// +/- prefix, styled as plain muted text.
						line.sign === "meta" && "text-muted-foreground italic"
					)}
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed snapshot for one completed call, never reordered
					key={`${index}-${line.sign}`}
				>
					{line.sign === "meta" ? "" : line.sign}
					{line.text}
				</div>
			))}
		</div>
	);
}
