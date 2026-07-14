// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { QuoteData } from "./finance-schemas";
import { DOWN_COLOR, UP_COLOR } from "./format";
import { QuoteCard } from "./quote-card";

// jsdom normalizes inline color styles to `rgb(...)`; convert the price-axis
// hex constants once so assertions compare like for like.
const HEX_PAIR_LENGTH = 2;
function hexToRgb(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 1 + HEX_PAIR_LENGTH), 16);
	const g = Number.parseInt(hex.slice(3, 3 + HEX_PAIR_LENGTH), 16);
	const b = Number.parseInt(hex.slice(5, 5 + HEX_PAIR_LENGTH), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

// Depth-ladder prices are deliberately distinct from every headline/StatGrid
// value (10.30/10.60/10.10/10.20/10.17) so `getByText` assertions below never
// collide with two elements sharing the same formatted number.
const QUOTE: QuoteData = {
	asks: [
		{ price: 10.55, volume: 200 },
		{ price: 10.52, volume: 800 },
	],
	bids: [
		{ price: 10.08, volume: 500 },
		{ price: 10.05, volume: 100 },
	],
	changePct: 1.24,
	high: 10.6,
	last: 10.3,
	low: 10.1,
	market: "a",
	name: "示例股份",
	open: 10.2,
	prevClose: 10.17,
	symbol: "600000",
	time: "",
	volume: 1_234_567,
};

// Every assertion below scopes queries through `within(container)` rather
// than the render-result's own query helpers, which query the whole
// `document.body` — this file's tests each call `render()` again without an
// intervening unmount, so an unscoped query would also match prior tests'
// leftover DOM.

it("renders the market badge and header", () => {
	const { container } = render(<QuoteCard data={QUOTE} />);
	const scope = within(container);
	expect(scope.getByText("示例股份")).toBeDefined();
	expect(scope.getByText("A股")).toBeDefined();
});

it("colors the last price and change by the price axis (红涨绿跌)", () => {
	const { container } = render(<QuoteCard data={QUOTE} />);
	const scope = within(container);
	const price = scope.getByText("10.30");
	expect(price.style.color).toBe(hexToRgb(UP_COLOR));
	expect(scope.getByText("+1.24%")).toBeDefined();
});

it("renders the StatGrid of key figures", () => {
	const { container } = render(<QuoteCard data={QUOTE} />);
	const scope = within(container);
	for (const label of ["今开", "最高", "最低", "昨收", "成交量"]) {
		expect(scope.getByText(label)).toBeDefined();
	}
});

it("renders the 盘口 depth ladder via ProportionBar's overlay fill", () => {
	const { container } = render(<QuoteCard data={QUOTE} />);
	const scope = within(container);
	// asks stack 卖2→卖1 above bids 买1→买2.
	expect(scope.getByText("卖1")).toBeDefined();
	expect(scope.getByText("卖2")).toBeDefined();
	expect(scope.getByText("买1")).toBeDefined();
	expect(scope.getByText("买2")).toBeDefined();

	// 卖1 (asks[0], 200 shares) is the smaller of the two ask rows (asks[1]
	// / 卖2 has 800), so its ProportionBar overlay fill should be narrower —
	// 200 / 800 (the ladder's max volume across both sides) = 25%.
	// `.overflow-hidden` scopes to ProportionBar's own outer div (it wraps
	// row content in an extra inner div, so a plain `closest("div")` would
	// stop one level too early).
	const askRow = scope
		.getByText("卖1")
		.closest("div.overflow-hidden") as HTMLElement;
	const fill = askRow.querySelector("div.absolute") as HTMLElement;
	expect(fill.style.backgroundColor).toBe(hexToRgb(DOWN_COLOR));
	expect(fill.style.width).toBe("25%"); // 200 / 800 max volume

	const bidRow = scope
		.getByText("买1")
		.closest("div.overflow-hidden") as HTMLElement;
	const bidFill = bidRow.querySelector("div.absolute") as HTMLElement;
	expect(bidFill.style.backgroundColor).toBe(hexToRgb(UP_COLOR));
	expect(bidFill.style.width).toBe("62.5%"); // 500 / 800 max volume
});

it("renders nothing for a symbol with no depth data", () => {
	const { container } = render(
		<QuoteCard data={{ ...QUOTE, asks: [], bids: [] }} />
	);
	expect(container.querySelectorAll("div.absolute").length).toBe(0);
});
