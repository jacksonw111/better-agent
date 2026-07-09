// Shared finance formatting helpers for the genui finance renderers. Pure
// functions only (no React) so they're trivially unit-testable and reusable
// across every finance card/table.
//
// 红涨绿跌 (Chinese market convention, opposite of US/EU): UP = red, DOWN =
// green. `changeColor` is the single source of truth for this — every
// finance component must go through it rather than hardcoding a color.

const UP_COLOR = "#ef4444";
const DOWN_COLOR = "#16a34a";

const WAN = 1e4; // 万
const YI = 1e8; // 亿
const WAN_YI = 1e12; // 万亿

const DEFAULT_DP = 2;
const COMPACT_DP = 2;
const DATE_PAD_WIDTH = 2;
const TIME_COMPONENT_RE = /\d{1,2}:\d{2}/;

/** Color for a signed change value: red for up, green for down, `null` (render
 * as muted) for zero/absent — never guess a color for a number that isn't
 * meaningfully positive or negative. */
export function changeColor(n: number | null | undefined): string | null {
	if (n === null || n === undefined || Number.isNaN(n) || n === 0) {
		return null;
	}
	return n > 0 ? UP_COLOR : DOWN_COLOR;
}

/** Compacts a large CNY-scale number into 万/亿/万亿, e.g. 1499222864079 →
 * "1.50万亿". `opts.cny` prefixes the result with ¥. Falls back to
 * `formatNum` below the 万 threshold. */
export function formatCompact(
	n: number | null | undefined,
	opts?: { cny?: boolean }
): string {
	if (n === null || n === undefined || Number.isNaN(n)) {
		return "—";
	}
	const prefix = opts?.cny ? "¥" : "";
	const abs = Math.abs(n);
	const sign = n < 0 ? "-" : "";
	if (abs >= WAN_YI) {
		return `${sign}${prefix}${(abs / WAN_YI).toFixed(COMPACT_DP)}万亿`;
	}
	if (abs >= YI) {
		return `${sign}${prefix}${(abs / YI).toFixed(COMPACT_DP)}亿`;
	}
	if (abs >= WAN) {
		return `${sign}${prefix}${(abs / WAN).toFixed(COMPACT_DP)}万`;
	}
	return `${prefix}${formatNum(n, COMPACT_DP)}`;
}

/** Fixed-decimal number formatting with thousands separators, "—" for
 * null/NaN. Used for prices, volumes, and other tabular-nums figures. */
export function formatNum(
	n: number | null | undefined,
	dp: number = DEFAULT_DP
): string {
	if (n === null || n === undefined || Number.isNaN(n)) {
		return "—";
	}
	return n.toLocaleString("en-US", {
		maximumFractionDigits: dp,
		minimumFractionDigits: dp,
	});
}

/** Signed percentage, e.g. "+1.24%" / "-0.49%" / "0.00%", "—" for null/NaN. */
export function formatPct(
	n: number | null | undefined,
	dp: number = DEFAULT_DP
): string {
	if (n === null || n === undefined || Number.isNaN(n)) {
		return "—";
	}
	const sign = n > 0 ? "+" : "";
	return `${sign}${n.toFixed(dp)}%`;
}

/** Resilient date/time formatting: "YYYY-MM-DD HH:mm" when the source string
 * carries a time component, "YYYY-MM-DD" otherwise. Uses UTC getters so
 * output doesn't depend on the runtime's local timezone. Unparseable input
 * is returned as-is (rather than dropped) so the caller can still see
 * something meaningful. */
export function formatDate(s: string | null | undefined): string {
	if (!s) {
		return "—";
	}
	const parsed = new Date(s);
	if (Number.isNaN(parsed.getTime())) {
		return s;
	}
	const pad = (v: number) => String(v).padStart(DATE_PAD_WIDTH, "0");
	const datePart = `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
	const hasTime = TIME_COMPONENT_RE.test(s);
	if (!hasTime) {
		return datePart;
	}
	return `${datePart} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}`;
}
