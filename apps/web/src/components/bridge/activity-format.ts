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

const SECONDS_PER_MINUTE = 60;
const SECONDS_PAD = 2;

/** The working indicator's elapsed counter (P1-T5): whole seconds under a
 * minute ("42s"), then minutes + zero-padded seconds ("3m 05s") — a
 * minutes-long turn shouldn't read as "183.0s". */
export function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.floor(elapsedMs / MS_PER_SECOND);
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = totalSeconds % SECONDS_PER_MINUTE;
	if (minutes === 0) {
		return `${seconds}s`;
	}
	return `${minutes}m ${String(seconds).padStart(SECONDS_PAD, "0")}s`;
}
