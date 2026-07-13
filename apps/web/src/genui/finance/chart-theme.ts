// Shared chart theme for the genui finance renderers — the single source of
// chart chrome (grid/axis/tooltip/crosshair) plus the three independent color
// axes from docs/design/finance-genui-redesign.md §5.2. Both chart engines —
// lightweight-charts (PriceChart) and recharts (BarSeries/LineSeries) — must
// pull every color/size/offset from here (§4, §11 "图表 token 单一出口");
// no chart component may hardcode chart chrome locally.
//
// Pure module (no JSX). The only import from a chart library is a type-only
// import of `ColorType`, erased at compile time, so this module carries zero
// runtime chart-library weight.
import type { ColorType } from "lightweight-charts";

// ---------------------------------------------------------------------------
// Color axis 1/3 — price (§5.2 价格轴). Re-exported, never redeclared: the
// single source of truth for 红涨绿跌 stays format.ts.
// ---------------------------------------------------------------------------
// biome-ignore lint/performance/noBarrelFile: single re-export site so chart components pull the price axis from chart-theme alongside the sentiment/probability/verdict axes below, instead of reaching into format.ts directly.
export { changeColor, DOWN_COLOR, UP_COLOR } from "./format";

// ---------------------------------------------------------------------------
// Color axis 2/3 — sentiment (§5.2 情绪轴: 看多/看空/中性). Canonical home —
// previously duplicated across divergence-card/sentiment-market/
// sentiment-ticker/sentiment-trending/sentiment-compare/prediction-markets.
// Never borrow the price axis's red/green for this axis, and vice versa.
// ---------------------------------------------------------------------------
export const SENTIMENT_BULL = "#10b981"; // emerald — 看多
export const SENTIMENT_BEAR = "#f43f5e"; // rose — 看空
export const SENTIMENT_NEUTRAL = "#9ca3af"; // gray — 中性

// ---------------------------------------------------------------------------
// Color axis 3/3 — probability / proportion (§5.2 概率·占比轴). Single flat
// color; direction is never encoded on this axis.
// ---------------------------------------------------------------------------
export const PROBABILITY = "#10b981"; // emerald

// ---------------------------------------------------------------------------
// Verdict semantic colors (§5.2 语义 verdict 色). Used ONLY by VerdictPill /
// SignalCard — never as a general-purpose chart color. 多头共振 reuses the
// price axis's UP_COLOR, 空头共振 reuses DOWN_COLOR (both re-exported above);
// only the divergence verdicts get colors of their own.
// ---------------------------------------------------------------------------
export const VERDICT_TOP_DIVERGENCE = "#f59e0b"; // amber — 顶背离
export const VERDICT_BOTTOM_DIVERGENCE = "#3b82f6"; // blue — 底背离

// ---------------------------------------------------------------------------
// Chart chrome tokens — lifted verbatim from the current candlestick-chart /
// money-flow-chart inline values (§4) so wiring them in changes nothing
// visually. Canvas-rendered chrome (lightweight-charts layout/grid/axis)
// cannot resolve CSS custom properties in a `fillStyle`/`strokeStyle`, so
// GRID_COLOR/AXIS_TEXT_COLOR are resolved literals shared by both engines —
// that's what makes the two engines actually look like one skin instead of
// only matching in one color scheme.
// ---------------------------------------------------------------------------
export const GRID_COLOR = "rgba(127, 127, 127, 0.12)";
export const AXIS_TEXT_COLOR = "#8b8b8b";
export const TICK_FONT_SIZE = 11;
export const CHART_BACKGROUND = "transparent";
export const DEFAULT_CHART_HEIGHT = 340;
export const RIGHT_OFFSET = 4;
const LIGHTWEIGHT_CROSSHAIR_MODE_NORMAL = 0;
const RECHARTS_GRID_DASH = "3 3";

// The recharts analog of a "crosshair": the shaded column under the hovered
// bar/point (money-flow-chart's existing `<Tooltip cursor={...}>`).
export const CROSSHAIR_CURSOR_FILL = "var(--muted)";
export const CROSSHAIR_CURSOR_OPACITY = 0.3;

// Tooltip surface (recharts `<Tooltip contentStyle>`), lifted from
// money-flow-chart's TOOLTIP_STYLE. CSS vars here are safe — this is a DOM
// overlay, not a canvas fill.
const TOOLTIP_BACKGROUND = "var(--popover)";
const TOOLTIP_BORDER = "1px solid var(--border)";
const TOOLTIP_RADIUS = "8px";
const TOOLTIP_FONT_SIZE = "12px";

export const TOOLTIP_STYLE = {
	background: TOOLTIP_BACKGROUND,
	border: TOOLTIP_BORDER,
	borderRadius: TOOLTIP_RADIUS,
	fontSize: TOOLTIP_FONT_SIZE,
} as const;

/**
 * §5.3 grouped-bar color rule: a bar chart answers exactly one of two
 * questions, and the answer picks the coloring scheme —
 *   - "direction" (净流入/流出, 多/空) → sign color (price axis's
 *     UP_COLOR/DOWN_COLOR via `changeColor`), zero-axis splits positive/
 *     negative.
 *   - "composition / multi-series comparison" (哪一档占多少, 超大/大/中/小单
 *     side by side) → ONE hue, N shades deep→light (`compositionHueRamp`
 *     below); sign is expressed by the zero axis, never by color. This is
 *     the fix for money_flow's 病根 #3: 四档 all sharing red/green today
 *     makes "which bucket is which" unreadable.
 * A component picks one rule, never both in the same chart.
 */
const RAMP_HUE = 217; // blue — the "non-directional value" hue already used
// for neutral series lines elsewhere (macro-panel/yield-curve LINE_COLOR),
// kept out of the red/green price axis and the emerald/rose sentiment axis.
const RAMP_SATURATION_PCT = 70;
const RAMP_LIGHTNESS_DEEPEST_PCT = 32; // largest-magnitude series (超大单)
const RAMP_LIGHTNESS_LIGHTEST_PCT = 78; // smallest-magnitude series (小单)

const HEX_RADIX = 16;
const HEX_BYTE_LEN = 2;
const RGB_MAX = 255;
const HUE_SEGMENT_DEG = 60;
const HUE_FULL_CIRCLE_DEG = 360;
const HUE_SEGMENT_COUNT = 6;

/** HSL → `#rrggbb`, so the ramp can feed the same hex-alpha-concat convention
 * (`${color}1a`) used by VerdictPill/ProportionBar — `Chip`'s active tint
 * concatenates an 8-digit hex alpha suffix onto `tone`, which only produces
 * valid CSS when `tone` is already hex, not `hsl(...)`. */
function hslToHex(
	hueDeg: number,
	saturationPct: number,
	lightnessPct: number
): string {
	const s = saturationPct / 100;
	const l = lightnessPct / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hPrime =
		(((hueDeg % HUE_FULL_CIRCLE_DEG) + HUE_FULL_CIRCLE_DEG) %
			HUE_FULL_CIRCLE_DEG) /
		HUE_SEGMENT_DEG;
	const x = c * (1 - Math.abs((hPrime % 2) - 1));
	const m = l - c / 2;
	let [r1, g1, b1] = [0, 0, 0];
	const segment = Math.floor(hPrime) % HUE_SEGMENT_COUNT;
	if (segment === 0) {
		[r1, g1, b1] = [c, x, 0];
	} else if (segment === 1) {
		[r1, g1, b1] = [x, c, 0];
	} else if (segment === 2) {
		[r1, g1, b1] = [0, c, x];
	} else if (segment === 3) {
		[r1, g1, b1] = [0, x, c];
	} else if (segment === 4) {
		[r1, g1, b1] = [x, 0, c];
	} else {
		[r1, g1, b1] = [c, 0, x];
	}
	const toHexByte = (channel: number) =>
		Math.round((channel + m) * RGB_MAX)
			.toString(HEX_RADIX)
			.padStart(HEX_BYTE_LEN, "0");
	return `#${toHexByte(r1)}${toHexByte(g1)}${toHexByte(b1)}`;
}

function rampColor(lightnessPct: number): string {
	return hslToHex(RAMP_HUE, RAMP_SATURATION_PCT, lightnessPct);
}

/** N shades of one hue, deep → light, for a "composition" grouped bar chart
 * per §5.3. `count <= 0` returns []; `count === 1` returns the deepest shade. */
export function compositionHueRamp(count: number): string[] {
	if (count <= 0) {
		return [];
	}
	if (count === 1) {
		return [rampColor(RAMP_LIGHTNESS_DEEPEST_PCT)];
	}
	const step =
		(RAMP_LIGHTNESS_LIGHTEST_PCT - RAMP_LIGHTNESS_DEEPEST_PCT) / (count - 1);
	return Array.from({ length: count }, (_, index) =>
		rampColor(RAMP_LIGHTNESS_DEEPEST_PCT + step * index)
	);
}

/** The `createChart` options (layout/grid/rightPriceScale/timeScale/
 * crosshair) every lightweight-charts instance should apply — lifted
 * verbatim from candlestick-chart.tsx's inline `buildChart` options.
 * `colorType` is threaded in by the caller (from the dynamically
 * `import()`-ed `lightweight-charts` module's `ColorType` enum) so this
 * module never itself imports the runtime chart library. */
export function lightweightChartOptions(colorType: ColorType) {
	return {
		crosshair: { mode: LIGHTWEIGHT_CROSSHAIR_MODE_NORMAL },
		grid: {
			horzLines: { color: GRID_COLOR },
			vertLines: { color: GRID_COLOR },
		},
		layout: {
			attributionLogo: false,
			background: { color: CHART_BACKGROUND, type: colorType },
			textColor: AXIS_TEXT_COLOR,
		},
		rightPriceScale: { borderColor: GRID_COLOR },
		timeScale: { borderColor: GRID_COLOR, rightOffset: RIGHT_OFFSET },
	} as const;
}

/** Shared recharts `<XAxis>`/`<YAxis>` props — axis line color + tick style. */
export const rechartsAxisTheme = {
	stroke: AXIS_TEXT_COLOR,
	tick: { fontSize: TICK_FONT_SIZE },
} as const;

/** Shared recharts `<CartesianGrid>` props. */
export const rechartsGridProps = {
	stroke: GRID_COLOR,
	strokeDasharray: RECHARTS_GRID_DASH,
	vertical: false,
} as const;

/** Shared recharts `<Tooltip cursor>` props — the recharts analog of a
 * crosshair (a shaded column under the hovered bar/point). */
export const rechartsCursorProps = {
	fill: CROSSHAIR_CURSOR_FILL,
	opacity: CROSSHAIR_CURSOR_OPACITY,
} as const;
