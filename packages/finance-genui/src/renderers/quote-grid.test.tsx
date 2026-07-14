// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { QuoteGrid } from "./quote-grid";
import type { QuoteTileData } from "./quote-tile";

// Every assertion below scopes queries through `within(container)` rather
// than the render-result's own query helpers, which query the whole
// `document.body` — this file's tests each call `render()` again without an
// intervening unmount, so an unscoped query would also match prior tests'
// leftover DOM.

const ITEMS: QuoteTileData[] = [
	{
		changePct: 1.5,
		expandItems: [{ label: "最高", value: "101.00" }],
		id: "a",
		last: 100,
		name: "标的A",
	},
	{
		changePct: -3.2,
		expandItems: [{ label: "最高", value: "48.00" }],
		id: "b",
		last: 45,
		name: "标的B",
	},
	{
		changePct: 0.4,
		expandItems: [{ label: "最高", value: "10.50" }],
		id: "c",
		last: 10,
		name: "标的C",
	},
];

it("renders a tile per item with name, price, and change", () => {
	const { container } = render(<QuoteGrid items={ITEMS} />);
	const scope = within(container);
	expect(scope.getByText("标的A")).toBeDefined();
	expect(scope.getByText("标的B")).toBeDefined();
	expect(scope.getByText("标的C")).toBeDefined();
	expect(scope.getByText("100.00")).toBeDefined();
	expect(scope.getByText("+1.50%")).toBeDefined();
	expect(scope.getByText("-3.20%")).toBeDefined();
});

it("renders nothing for an empty payload", () => {
	const { container } = render(<QuoteGrid items={[]} />);
	expect(container.firstChild).toBeNull();
});

/** Reads tile name order from the tile grid only — a plain `querySelectorAll("button")`
 * would also match the Segmented sort control's three option buttons, which
 * live in a sibling div and aren't tiles. */
function tileOrder(container: HTMLElement): string[] {
	const grid = container.querySelector("div.grid") as HTMLElement;
	return Array.from(grid.querySelectorAll(":scope > button")).map(
		(button) => button.querySelector("span")?.textContent ?? ""
	);
}

it("sort reorders tiles by change% (desc then asc), and 原序 restores source order", () => {
	const { container } = render(<QuoteGrid items={ITEMS} />);
	const scope = within(container);

	// Source order before any sort is applied.
	expect(tileOrder(container)).toEqual(["标的A", "标的B", "标的C"]);

	fireEvent.click(scope.getByText("涨幅"));
	expect(tileOrder(container)).toEqual(["标的A", "标的C", "标的B"]);

	fireEvent.click(scope.getByText("跌幅"));
	expect(tileOrder(container)).toEqual(["标的B", "标的C", "标的A"]);

	fireEvent.click(scope.getByText("原序"));
	expect(tileOrder(container)).toEqual(["标的A", "标的B", "标的C"]);
});

it("tapping a tile expands it to show extra fields, tapping again collapses it", () => {
	const { container } = render(<QuoteGrid items={ITEMS} />);
	const scope = within(container);
	const tileButton = scope.getByText("标的A").closest("button") as HTMLElement;

	expect(scope.queryByText("最高")).toBeNull();
	expect(tileButton.getAttribute("aria-expanded")).toBe("false");

	fireEvent.click(tileButton);
	expect(scope.getByText("最高")).toBeDefined();
	expect(scope.getByText("101.00")).toBeDefined();
	expect(tileButton.getAttribute("aria-expanded")).toBe("true");

	fireEvent.click(tileButton);
	expect(scope.queryByText("最高")).toBeNull();
	expect(tileButton.getAttribute("aria-expanded")).toBe("false");
});
