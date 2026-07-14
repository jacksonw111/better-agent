// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { SectorHeatmap } from "./sector-heatmap";

// Smoke test for finance_sector_list's Heatmap variant (design doc §8.6
// "Heatmap 变体(sector_list):2D 色块网格,cell hover 读值,So 按涨跌排色").
// Asserts: cell content, background tint sourced from the price axis
// (changeColor + intensity ramp, never a rogue hex), and that Sort (reused
// from `useRankListOrchestration`, the same hook `RankList` itself calls)
// reorders the grid.

// Price-axis hex from format.ts (UP_COLOR/DOWN_COLOR), converted to the
// rgba() form jsdom normalizes inline styles to, at the intensity this
// component's tileBackground() computes for the fixtures below.
const UP_TINT = "rgba(239, 68, 68, 0.55)"; // #ef4444, |6.5%| clamped to the 5% ceiling → max alpha
const DOWN_TINT = "rgba(22, 163, 74, 0.38)"; // #16a34a, |-3.2%| → 0.08 + (3.2/5)*(0.55-0.08)

const ROWS = [
	{
		changePct: 6.5,
		code: "BK01",
		leadStockCode: "600001",
		leadStockChangePct: 8.1,
		mainNet: null,
		name: "白酒",
		price: 100,
	},
	{
		changePct: -3.2,
		code: "BK02",
		leadStockCode: "",
		leadStockChangePct: null,
		mainNet: null,
		name: "银行",
		price: 50,
	},
	{
		changePct: 0,
		code: "BK03",
		leadStockCode: "",
		leadStockChangePct: null,
		mainNet: null,
		name: "无变化",
		price: 10,
	},
];

function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition bitmask check, standard DOM idiom.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

const LEAD_STOCK_RE = /领涨 600001/;
const SORT_BUTTON_RE = /涨跌幅/;

function tileFor(container: HTMLElement, name: string): HTMLElement {
	return within(container).getByText(name).closest("button") as HTMLElement;
}

it("renders every sector's name, code, and change%, ranked by change% descending", () => {
	const { container } = render(<SectorHeatmap items={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("白酒")).toBeDefined();
	expect(scope.getByText("银行")).toBeDefined();
	expect(scope.getByText("+6.50%")).toBeDefined();
	expect(scope.getByText("-3.20%")).toBeDefined();
	// desc default: 6.5% before 0% before -3.2%.
	expect(isBefore(scope.getByText("白酒"), scope.getByText("银行"))).toBe(true);
});

it("tints each cell's background by change% via the price axis, undefined for zero change", () => {
	const { container } = render(<SectorHeatmap items={ROWS} />);
	expect(tileFor(container, "白酒").style.backgroundColor).toBe(UP_TINT);
	expect(tileFor(container, "银行").style.backgroundColor).toBe(DOWN_TINT);
	expect(tileFor(container, "无变化").style.backgroundColor).toBe("");
});

it("reorders the grid when toggling the 涨跌幅 sort direction", () => {
	const { container } = render(<SectorHeatmap items={ROWS} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: SORT_BUTTON_RE }));
	// asc: -3.2% first, +6.5% last.
	expect(isBefore(scope.getByText("银行"), scope.getByText("白酒"))).toBe(true);
});

it("keeps hover-reveal price/领涨股 detail in the DOM (opacity-toggled, not conditionally rendered)", () => {
	const { container } = render(<SectorHeatmap items={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("100.00")).toBeDefined();
	expect(scope.getByText(LEAD_STOCK_RE)).toBeDefined();
	expect(scope.getByText("+8.10%")).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<SectorHeatmap items={[]} />);
	expect(container.textContent).toBe("");
});
