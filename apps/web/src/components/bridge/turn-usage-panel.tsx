import type { TurnUsageDetail } from "./bridge-session-status";
import {
	formatCostUsd,
	formatDurationMs,
	formatTokenCount,
} from "./bridge-usage-format";

interface UsageStat {
	label: string;
	value: string;
}

/** A token count as a display string, or `undefined` when the CLI didn't
 * report that bucket (cache figures only exist when prompt caching was in
 * play) so the panel can drop it entirely. */
function tokenStat(count: number | undefined): string | undefined {
	return count === undefined ? undefined : formatTokenCount(count);
}

/** Flattens a `turn_usage` detail into the labeled stats the panel shows —
 * cost, the four token buckets, turn count, and duration — dropping any figure
 * the CLI didn't report. Declared as a label→value table so the branching
 * stays a single filter, not one `if` per stat. Exported for the usage modal
 * (usage-modal.tsx), whose 本回合 section shows the same table. */
export function usageStats(detail: TurnUsageDetail): UsageStat[] {
	const tokens = detail.usage;
	const candidates: [string, string | undefined][] = [
		[
			"Cost",
			detail.costUsd === undefined ? undefined : formatCostUsd(detail.costUsd),
		],
		["Input", tokenStat(tokens?.inputTokens)],
		["Output", tokenStat(tokens?.outputTokens)],
		["Cache read", tokenStat(tokens?.cacheReadInputTokens)],
		["Cache write", tokenStat(tokens?.cacheCreationInputTokens)],
		[
			"Turns",
			detail.numTurns === undefined ? undefined : String(detail.numTurns),
		],
		[
			"Duration",
			detail.durationMs === undefined
				? undefined
				: formatDurationMs(detail.durationMs),
		],
	];
	const stats: UsageStat[] = [];
	for (const [label, value] of candidates) {
		if (value !== undefined) {
			stats.push({ label, value });
		}
	}
	return stats;
}

export interface TurnUsagePanelProps {
	/** The latest `turn_usage` detail, or `null` before any turn has finished
	 * — renders nothing until then. */
	detail: TurnUsageDetail | null;
}

/**
 * Per-session usage summary: cost, the input/output/cache-read/cache-write
 * token breakdown, turn count, and duration from the curated `turn_usage`
 * status event (see bridge-session-status.ts), laid out as a compact,
 * borderless labeled stat grid above the composer. Metadata, not a chat
 * message — never rendered inline with the feed. Capability-gated by its
 * caller on `usageMode === "stream"`.
 */
export function TurnUsagePanel({ detail }: TurnUsagePanelProps) {
	if (!detail) {
		return null;
	}
	const stats = usageStats(detail);
	if (stats.length === 0) {
		return null;
	}
	return (
		<div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
			{/* Outer box mirrors the composer's outer (max-w-3xl + px-3/sm:px-4);
			 * the inner bg fills only the content box, so its left/right edges
			 * land exactly on the input box's border instead of spanning past
			 * it. */}
			<div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md bg-muted/40 px-3 py-2">
				{stats.map((stat) => (
					<div className="flex flex-col" key={stat.label}>
						<span className="text-muted-foreground text-xs uppercase tracking-wide">
							{stat.label}
						</span>
						<span className="font-medium text-sm tabular-nums">
							{stat.value}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
