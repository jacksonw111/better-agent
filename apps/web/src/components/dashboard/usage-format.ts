// Pure display formatters for usage figures — kept out of the components so
// the rounding/threshold choices are unit-testable without rendering anything.

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
