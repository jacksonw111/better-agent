// Pure display formatters for the `turn_usage` chip and `session_ready`
// header — kept out of the components so the rounding/threshold choices are
// unit-testable without rendering anything.

const COST_DECIMAL_PLACES = 4;

/** `$0.0123` — always four decimal places, since a single turn's cost is
 * routinely sub-cent and a rounded `$0.01` would hide most of the signal. */
export function formatCostUsd(costUsd: number): string {
	return `$${costUsd.toFixed(COST_DECIMAL_PLACES)}`;
}

const TOKEN_COMPACT_THRESHOLD = 1000;
const TOKEN_COMPACT_DIVISOR = 1000;
const TOKEN_COMPACT_DECIMALS = 1;

/** Compact token count: `847` stays as-is, `1200` becomes `1.2k`. */
export function formatTokenCount(count: number): string {
	if (count < TOKEN_COMPACT_THRESHOLD) {
		return String(count);
	}
	return `${(count / TOKEN_COMPACT_DIVISOR).toFixed(TOKEN_COMPACT_DECIMALS)}k`;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const DURATION_SECONDS_DECIMALS = 1;

/** Human duration for a turn: `4.5s` under a minute, `1m 5s` past it. Sourced
 * from `turn_usage`'s `durationMs`, so always a short, single-turn span. */
export function formatDurationMs(durationMs: number): string {
	const totalSeconds = durationMs / MS_PER_SECOND;
	if (totalSeconds < SECONDS_PER_MINUTE) {
		return `${totalSeconds.toFixed(DURATION_SECONDS_DECIMALS)}s`;
	}
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = Math.round(totalSeconds % SECONDS_PER_MINUTE);
	return `${minutes}m ${seconds}s`;
}

/** Whole-`k` token count for the minimal `usage_update` line: `847` stays,
 * `48213` becomes `48k` (no decimal). Distinct from `formatTokenCount`'s
 * one-decimal form, which the denser turn_usage grid uses — this line is meant
 * to be glanceable, so `48k/200k` reads better than `48.2k/200.0k`. */
export function formatTokensCompact(count: number): string {
	if (count < TOKEN_COMPACT_THRESHOLD) {
		return String(count);
	}
	return `${Math.round(count / TOKEN_COMPACT_DIVISOR)}k`;
}

const TRAILING_ZEROS_RE = /0+$/;
const TRAILING_DOT_RE = /\.$/;

/** Compact cost for the `usage_update` line: `$0.045`, trailing zeros trimmed
 * (`0.0450` → `$0.045`, `1` → `$1`). The turn_usage grid keeps `formatCostUsd`'s
 * fixed 4-decimal form; this line trades that precision for brevity. */
export function formatCostCompact(amount: number): string {
	const trimmed = amount
		.toFixed(COST_DECIMAL_PLACES)
		.replace(TRAILING_ZEROS_RE, "")
		.replace(TRAILING_DOT_RE, "");
	return `$${trimmed}`;
}

/** opencode's streamed context window line: `48k/200k tok · 24%` — the % is
 * derived client-side as used/size, whole-`k` counts for a glanceable line. */
export function formatContextUsage(used: number, size: number): string {
	const pct = size > 0 ? Math.round((used / size) * PERCENT_MULTIPLIER) : 0;
	return `${formatTokensCompact(used)}/${formatTokensCompact(size)} tok · ${pct}%`;
}

const PERCENT_MULTIPLIER = 100;

const CWD_MAX_LENGTH = 40;

/** `status_snapshot`'s context usage as a display string: `48k/200k tok · 24%`.
 * Unlike opencode's streamed `usage_update` (`formatContextUsage`, which
 * always gets both used+size together), a `status_snapshot`'s fields can
 * arrive independently — this tolerates any subset, deriving the percentage
 * from used/size only when the agent didn't report `pct` itself. `null` when
 * nothing usable arrived. */
export function formatStatusContextUsage(usage: {
	pct?: number;
	size?: number;
	used?: number;
}): string | null {
	const parts: string[] = [];
	if (usage.used !== undefined && usage.size !== undefined) {
		parts.push(
			`${formatTokensCompact(usage.used)}/${formatTokensCompact(usage.size)} tok`
		);
	}
	const pct =
		usage.pct ??
		(usage.used !== undefined && usage.size !== undefined && usage.size > 0
			? Math.round((usage.used / usage.size) * PERCENT_MULTIPLIER)
			: undefined);
	if (pct !== undefined) {
		parts.push(`${pct}%`);
	}
	return parts.length > 0 ? parts.join(" · ") : null;
}

/** Truncates a long cwd path from the front (keeping the tail — the part
 * that actually distinguishes one project directory from another) so the
 * header never wraps or overflows the pill row. Callers should also set
 * `title` to the untruncated path. */
export function truncateCwd(cwd: string): string {
	if (cwd.length <= CWD_MAX_LENGTH) {
		return cwd;
	}
	return `…${cwd.slice(cwd.length - CWD_MAX_LENGTH)}`;
}
