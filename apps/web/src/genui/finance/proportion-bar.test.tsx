// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PROBABILITY, SENTIMENT_BEAR, SENTIMENT_BULL } from "./chart-theme";
import { UP_COLOR } from "./format";
import { ProportionBar } from "./proportion-bar";

// `useReducedMotion` is mocked to true for the whole file so bar fills render
// as plain divs with the final width set synchronously — the animated
// (motion.div) path only reaches its target width after a real animation
// frame, which render() doesn't wait for, making width assertions flaky.
// Reduced-motion output is otherwise identical in every way that matters
// here (same DOM shape, same final percent), so it's a faithful way to test
// the width/color/direction math. `vi.mock` calls are hoisted above imports
// by vitest, so this still applies before `proportion-bar.tsx` is evaluated.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const HEX_PAIR_LENGTH = 2;

/** jsdom normalizes any inline color style to `rgb(...)`, so hex constants
 * from chart-theme/format need converting before comparing against
 * `element.style.backgroundColor`. */
function hexToRgb(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 1 + HEX_PAIR_LENGTH), 16);
	const g = Number.parseInt(hex.slice(3, 3 + HEX_PAIR_LENGTH), 16);
	const b = Number.parseInt(hex.slice(5, 5 + HEX_PAIR_LENGTH), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

it("single-value mode: fraction maps to fill width and tone color", () => {
	const { container } = render(<ProportionBar fraction={0.42} tone="up" />);
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.style.width).toBe("42%");
	expect(fill.style.backgroundColor).toBe(hexToRgb(UP_COLOR));
});

it("single-value mode: value+max computes the same fraction as a direct fraction", () => {
	const { container } = render(
		<ProportionBar max={200} tone="up" value={50} />
	);
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.style.width).toBe("25%");
});

it("clamps out-of-range fractions to 0..100%", () => {
	const { container } = render(<ProportionBar fraction={1.5} tone="up" />);
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.style.width).toBe("100%");
});

it("grow-from-end positions the fill at the right edge instead of the left", () => {
	const { container } = render(
		<ProportionBar direction="end" fraction={0.3} tone="down" />
	);
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.className).toContain("right-0");
	expect(fill.className).not.toContain("left-0");
});

it("defaults to grow-from-start", () => {
	const { container } = render(<ProportionBar fraction={0.3} tone="down" />);
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.className).toContain("left-0");
});

it("an explicit color overrides tone", () => {
	const hueRampColor = "#183272"; // a compositionHueRamp()-style hex, not one of the axis constants
	const { container } = render(
		<ProportionBar color={hueRampColor} fraction={0.6} tone="probability" />
	);
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.style.backgroundColor).toBe(hexToRgb(hueRampColor));
});

it("falls back to the probability axis color when only tone is given", () => {
	const { container } = render(
		<ProportionBar fraction={0.6} tone="probability" />
	);
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.style.backgroundColor).toBe(hexToRgb(PROBABILITY));
});

it("renders label and valueLabel around the track", () => {
	const { container } = render(
		<ProportionBar fraction={0.5} label="卖1" tone="up" valueLabel="12.30" />
	);
	const scope = within(container);
	expect(scope.getByText("卖1")).toBeDefined();
	expect(scope.getByText("12.30")).toBeDefined();
});

it("split mode: each segment's width matches its own fraction of the track", () => {
	const { container } = render(
		<ProportionBar
			segments={[
				{ color: SENTIMENT_BULL, fraction: 0.7, key: "bull" },
				{ color: SENTIMENT_BEAR, fraction: 0.3, key: "bear" },
			]}
		/>
	);
	const [bull, bear] = Array.from(
		container.querySelectorAll("div.h-full")
	) as HTMLElement[];
	expect(bull.style.width).toBe("70%");
	expect(bull.style.backgroundColor).toBe(hexToRgb(SENTIMENT_BULL));
	expect(bear.style.width).toBe("30%");
	expect(bear.style.backgroundColor).toBe(hexToRgb(SENTIMENT_BEAR));
});

it("overlay variant renders the fill behind children rather than in a track", () => {
	const { container } = render(
		<ProportionBar fraction={0.8} tone="up" variant="overlay">
			<span>卖1 12.30 1,000</span>
		</ProportionBar>
	);
	const scope = within(container);
	expect(scope.getByText("卖1 12.30 1,000")).toBeDefined();
	const fill = container.querySelector("div.absolute") as HTMLElement;
	expect(fill.style.width).toBe("80%");
	expect(fill.style.opacity).toBe("0.08");
	// overlay fills are never a rounded pill — they sit behind arbitrary
	// row content clipped by the row's own rounding.
	expect(fill.className).not.toContain("rounded-full");
});
