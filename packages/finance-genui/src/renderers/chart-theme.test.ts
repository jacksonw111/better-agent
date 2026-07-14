import { expect, it } from "vitest";
import {
	changeColor,
	compositionHueRamp,
	DOWN_COLOR,
	PROBABILITY,
	SENTIMENT_BEAR,
	SENTIMENT_BULL,
	SENTIMENT_NEUTRAL,
	UP_COLOR,
	VERDICT_BOTTOM_DIVERGENCE,
	VERDICT_TOP_DIVERGENCE,
} from "./chart-theme";
import {
	DOWN_COLOR as FORMAT_DOWN_COLOR,
	UP_COLOR as FORMAT_UP_COLOR,
	changeColor as formatChangeColor,
} from "./format";

const COMPOSITION_SERIES_COUNT = 4; // money_flow's 超大/大/中/小单
// Hex so `Chip`'s `${tone}${alpha}` hex-alpha-concat tint (matching
// VerdictPill/ProportionBar) produces valid CSS instead of `hsl(...)26`.
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

/** Approximate relative luminance from a hex color, standing in for HSL
 * lightness now that the ramp emits hex — still strictly ascending
 * deep→light across the ramp. */
function luminanceOf(hex: string): number {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

it("re-exports the price axis from format.ts by identity, never redeclaring it", () => {
	expect(UP_COLOR).toBe(FORMAT_UP_COLOR);
	expect(DOWN_COLOR).toBe(FORMAT_DOWN_COLOR);
	expect(changeColor).toBe(formatChangeColor);
});

it("has the specified sentiment axis values", () => {
	expect(SENTIMENT_BULL).toBe("#10b981");
	expect(SENTIMENT_BEAR).toBe("#f43f5e");
	expect(SENTIMENT_NEUTRAL).toBe("#9ca3af");
});

it("has the specified probability axis value", () => {
	expect(PROBABILITY).toBe("#10b981");
});

it("has the specified verdict semantic colors", () => {
	expect(VERDICT_TOP_DIVERGENCE).toBe("#f59e0b");
	expect(VERDICT_BOTTOM_DIVERGENCE).toBe("#3b82f6");
});

it("compositionHueRamp returns N distinct hex shades of one hue for N composition series", () => {
	const shades = compositionHueRamp(COMPOSITION_SERIES_COUNT);
	expect(shades).toHaveLength(COMPOSITION_SERIES_COUNT);
	expect(new Set(shades).size).toBe(COMPOSITION_SERIES_COUNT);
	for (const shade of shades) {
		expect(shade).toMatch(HEX_COLOR_RE);
	}
});

it("compositionHueRamp goes deep to light (ascending luminance)", () => {
	const shades = compositionHueRamp(COMPOSITION_SERIES_COUNT);
	const luminances = shades.map(luminanceOf);
	for (let i = 1; i < luminances.length; i++) {
		expect(luminances[i]).toBeGreaterThan(luminances[i - 1] as number);
	}
});

it("compositionHueRamp handles edge counts", () => {
	expect(compositionHueRamp(0)).toEqual([]);
	expect(compositionHueRamp(1)).toHaveLength(1);
});
