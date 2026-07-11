// R1-T3: shared formatting helpers for ActivityItem's header — split out of
// bridge-tool-card.tsx purely to keep pure, unit-testable logic out of the
// component file (and under the repo's 300-line cap).

const MS_PER_SECOND = 1000;

/** A tool call's wall-clock duration, right-aligned on its ActivityItem
 * header — always one decimal place in seconds ("0.4s", "3.1s"), matching
 * the design spec's examples regardless of magnitude. */
export function formatDurationMs(durationMs: number): string {
	return `${(durationMs / MS_PER_SECOND).toFixed(1)}s`;
}
