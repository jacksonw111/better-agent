// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SectorStocksList } from "./sector-stocks-list";

// Smoke test for finance_sector_constituents' `RankList` wiring (design doc
// §8.6, "E 下钻 → 个股快照"). Archetype-level Sort/Filter is covered by
// rank-list.test.tsx; this asserts sector-stocks-list.tsx's own field mapping
// (|涨跌幅| headline metric, price secondary) and its Expand → StatGrid
// snapshot survived the port.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const ROWS = [
	{ changePct: 3.5, code: "600000", name: "浦发银行", price: 8.1 },
	{ changePct: -6.2, code: "600001", name: "邯郸钢铁", price: 4.4 },
];

it("renders every row's name, code, and price", () => {
	const { container } = render(<SectorStocksList data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("浦发银行")).toBeDefined();
	expect(scope.getByText("600000")).toBeDefined();
	expect(scope.getByText("邯郸钢铁")).toBeDefined();
});

it("expands a row to reveal its 代码/最新价 snapshot", () => {
	const { container } = render(<SectorStocksList data={ROWS} />);
	const scope = within(container);
	// "代码" is unique to the StatGrid (unlike "最新价", which also labels the
	// always-visible Sort option of the same name, so it legitimately appears
	// in the tree both before and after Expand).
	expect(scope.queryByText("代码")).toBeNull();
	fireEvent.click(scope.getByText("浦发银行").closest("button") as HTMLElement);
	expect(scope.getByText("代码")).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<SectorStocksList data={[]} />);
	expect(container.textContent).toBe("");
});
