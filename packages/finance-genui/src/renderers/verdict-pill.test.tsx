// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { AlertTriangle, Minus } from "lucide-react";
import { expect, it } from "vitest";
import { VerdictPill } from "./verdict-pill";

const AMBER = "#f59e0b";
const AMBER_RGB = { b: 11, g: 158, r: 245 };
const ALPHA_PRECISION = 2;
const EXPECTED_ALPHA = 0x1a / 0xff; // matches BG_ALPHA_HEX's ~10% opacity
const RGBA_RE = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/;

/** jsdom normalizes any inline color style (including 8-digit hex-with-alpha)
 * to `rgb(...)`/`rgba(...)`, so assert on the parsed channels rather than a
 * literal hex string. */
function parseRgba(css: string) {
	const match = css.match(RGBA_RE);
	if (!match) {
		throw new Error(`not a css color: ${css}`);
	}
	const [, r, g, b, a] = match;
	return {
		a: a === undefined ? 1 : Number(a),
		b: Number(b),
		g: Number(g),
		r: Number(r),
	};
}

it("a colored verdict tints the pill background and text with that color", () => {
	const { container } = render(
		<VerdictPill color={AMBER} icon={AlertTriangle} label="顶背离 · 价涨情弱" />
	);
	const pill = container.firstElementChild as HTMLElement;
	const background = parseRgba(pill.style.backgroundColor);
	expect(background.r).toBe(AMBER_RGB.r);
	expect(background.g).toBe(AMBER_RGB.g);
	expect(background.b).toBe(AMBER_RGB.b);
	expect(background.a).toBeCloseTo(EXPECTED_ALPHA, ALPHA_PRECISION);
	const text = parseRgba(pill.style.color);
	expect(text).toMatchObject(AMBER_RGB);
	expect(pill.className).not.toContain("bg-muted/40");
	expect(within(container).getByText("顶背离 · 价涨情弱")).toBeDefined();
});

it("a null color falls back to the neutral chip with no inline color", () => {
	const { container } = render(
		<VerdictPill color={null} icon={Minus} label="中性" />
	);
	const pill = container.firstElementChild as HTMLElement;
	expect(pill.style.backgroundColor).toBe("");
	expect(pill.className).toContain("bg-muted/40");
	expect(pill.className).toContain("text-muted-foreground");
});

it("an undefined color also falls back to the neutral chip", () => {
	const { container } = render(<VerdictPill icon={Minus} label="数据不足" />);
	const pill = container.firstElementChild as HTMLElement;
	expect(pill.className).toContain("bg-muted/40");
});
