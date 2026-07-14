// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IndexWeights } from "./index-weights";

// Smoke test for finance_index_weights's `RankList` wiring (design doc
// §8.6/§9 "旧的柱状图改成榜单" ⚠). Archetype-level Sort/Filter/Expand
// mechanics are covered by rank-list.test.tsx; this asserts
// index-weights.tsx's own field mapping — weight headline bar, ranking, and
// 行业/PE/ROE moved into the Expand region.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const ROWS = [
	{
		changePct: 4.21,
		closePrice: 1688.5,
		code: "600519",
		industry: "白酒",
		name: "贵州茅台",
		pe: 35.2,
		roe: 28.5,
		weight: 5.2,
	},
	{
		changePct: -1.05,
		closePrice: 12.3,
		code: "000001",
		industry: "银行",
		name: "平安银行",
		pe: 6.1,
		roe: 10.2,
		weight: 1.1,
	},
];

function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition bitmask check, standard DOM idiom.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

function barWidths(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("div.absolute")).map(
		(el) => (el as HTMLElement).style.width
	);
}

it("renders every row's name, code, price, and change%, ranked by weight descending", () => {
	const { container } = render(<IndexWeights data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("贵州茅台")).toBeDefined();
	expect(scope.getByText("600519")).toBeDefined();
	expect(scope.getByText("+4.21%")).toBeDefined();
	expect(scope.getByText("-1.05%")).toBeDefined();
	expect(
		isBefore(scope.getByText("贵州茅台"), scope.getByText("平安银行"))
	).toBe(true);
	// weight headline bar: 贵州茅台(5.2) is the set's max, 平安银行(1.1) scales relative to it.
	expect(barWidths(container)).toEqual(["100%", `${(1.1 / 5.2) * 100}%`]);
});

it("reorders rows when sorting by 涨跌幅 instead of weight", () => {
	const { container } = render(<IndexWeights data={ROWS} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "涨跌幅" }));
	expect(
		isBefore(scope.getByText("贵州茅台"), scope.getByText("平安银行"))
	).toBe(true);
	fireEvent.click(scope.getByRole("button", { name: "涨跌幅" }));
	expect(
		isBefore(scope.getByText("平安银行"), scope.getByText("贵州茅台"))
	).toBe(true);
});

it("reveals 行业/PE/ROE only once a row is expanded", () => {
	const { container } = render(<IndexWeights data={ROWS} />);
	const scope = within(container);
	expect(scope.queryByText("白酒")).toBeNull();
	fireEvent.click(scope.getByText("贵州茅台").closest("button") as HTMLElement);
	expect(scope.getByText("白酒")).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<IndexWeights data={[]} />);
	expect(container.textContent).toBe("");
});
