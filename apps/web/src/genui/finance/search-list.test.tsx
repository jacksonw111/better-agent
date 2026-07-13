// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SearchList } from "./search-list";

// Smoke test for finance_search's `RankList` wiring (design doc §8.6, "E 下钻
// → quote"). Archetype-level Sort/Filter/Expand is covered by
// rank-list.test.tsx; this asserts search-list.tsx's own field mapping
// (position-based relevance order, 交易所 filter dimension, translated 市场
// in the expanded snapshot) survived the port.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const ROWS = [
	{ code: "600519", exchange: "SH", market: "a_share", name: "贵州茅台" },
	{ code: "000001", exchange: "SZ", market: "a_share", name: "平安银行" },
];

it("renders every hit's name, code, and exchange, in payload order", () => {
	const { container } = render(<SearchList data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("贵州茅台")).toBeDefined();
	expect(scope.getByText("600519")).toBeDefined();
	expect(scope.getByText("平安银行")).toBeDefined();
	const mask = scope
		.getByText("贵州茅台")
		.compareDocumentPosition(scope.getByText("平安银行"));
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition bitmask check, standard DOM idiom.
	expect(Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
});

it("filters hits by 交易所 when more than one is present", () => {
	const { container } = render(<SearchList data={ROWS} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "上交所" }));
	expect(scope.getByText("贵州茅台")).toBeDefined();
	expect(scope.queryByText("平安银行")).toBeNull();
});

it("omits the 交易所 filter when every hit shares the same exchange", () => {
	const { container } = render(
		<SearchList
			data={[
				{ code: "600519", exchange: "SH", market: "a_share", name: "贵州茅台" },
				{ code: "600000", exchange: "SH", market: "a_share", name: "浦发银行" },
			]}
		/>
	);
	expect(
		within(container).queryByRole("button", { name: "上交所" })
	).toBeNull();
});

it("expands a hit to reveal its translated 市场 in the snapshot", () => {
	const { container } = render(<SearchList data={ROWS} />);
	const scope = within(container);
	expect(scope.queryByText("A股")).toBeNull();
	fireEvent.click(scope.getByText("贵州茅台").closest("button") as HTMLElement);
	expect(scope.getByText("A股")).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<SearchList data={[]} />);
	expect(container.textContent).toBe("");
});
