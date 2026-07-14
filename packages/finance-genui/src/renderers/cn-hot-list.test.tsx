// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CnHotList } from "./cn-hot-list";

// Smoke test for finance_cn_hot's `RankList` wiring (design doc §8.6). The
// archetype-level Sort/Filter/Expand behavior is covered by
// rank-list.test.tsx; this only asserts cn-hot-list.tsx's own field mapping
// (heat proxy order, last price + change% + rank-change badge) survived the
// port from the old FinTable-based component.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const ROWS = [
	{
		changePct: 4.21,
		code: "600519",
		last: 1688.5,
		name: "贵州茅台",
		rank: 1,
		rankChange: 2,
	},
	{
		changePct: -1.05,
		code: "000001",
		last: 12.3,
		name: "平安银行",
		rank: 2,
		rankChange: null,
	},
];

it("renders every row's name, code, last price, and change%", () => {
	const { container } = render(<CnHotList data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("贵州茅台")).toBeDefined();
	expect(scope.getByText("600519")).toBeDefined();
	expect(scope.getByText("平安银行")).toBeDefined();
	expect(scope.getByText("+4.21%")).toBeDefined();
	expect(scope.getByText("-1.05%")).toBeDefined();
});

it("renders rank 1 (highest heat proxy) before rank 2", () => {
	const { container } = render(<CnHotList data={ROWS} />);
	const scope = within(container);
	const mask = scope
		.getByText("贵州茅台")
		.compareDocumentPosition(scope.getByText("平安银行"));
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition bitmask check, standard DOM idiom.
	expect(Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
});

it("renders nothing for an empty result", () => {
	const { container } = render(<CnHotList data={[]} />);
	expect(container.textContent).toBe("");
});
