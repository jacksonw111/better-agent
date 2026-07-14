// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import { BlockTradesTable } from "./block-trades-table";
import type { BlockTradeRowData } from "./finance-schemas-fe15";

// Render-level tests for `block_trades` on the DataTable primitive (Phase 1
// Batch B2). jsdom lacks ResizeObserver (recharts' ResponsiveContainer needs
// it) and matchMedia; stubbed as in statements-table.test.tsx / the exemplar
// this batch copies.
beforeAll(() => {
	globalThis.ResizeObserver ??= class {
		disconnect() {
			return;
		}
		observe() {
			return;
		}
		unobserve() {
			return;
		}
	};
	window.matchMedia ??= (query: string) =>
		({
			addEventListener: () => undefined,
			addListener: () => undefined,
			dispatchEvent: () => false,
			matches: query.includes("reduce"),
			media: query,
			onchange: null,
			removeEventListener: () => undefined,
			removeListener: () => undefined,
		}) as unknown as MediaQueryList;
});

function blockTradeRow(
	overrides: Partial<BlockTradeRowData> & { tradeDate: string }
): BlockTradeRowData {
	return {
		buyer: "",
		code: "",
		dealAmount: null,
		dealPrice: null,
		dealVolume: null,
		name: "",
		premiumPct: null,
		seller: "",
		...overrides,
	};
}

// Newest-first, as the tool returns them; deal amounts deliberately not in
// source order so the sort test observes a real reorder.
const ROWS: BlockTradeRowData[] = [
	blockTradeRow({
		buyer: "机构专用",
		code: "600000",
		dealAmount: 5_000_000,
		dealPrice: 9.5,
		name: "浦发银行",
		premiumPct: -3.2,
		seller: "营业部A",
		tradeDate: "2023-06-03",
	}),
	blockTradeRow({
		buyer: "营业部B",
		code: "600001",
		dealAmount: 12_000_000,
		dealPrice: 4.2,
		name: "邯郸钢铁",
		premiumPct: 1.1,
		seller: "机构专用",
		tradeDate: "2023-06-02",
	}),
	blockTradeRow({
		buyer: "营业部C",
		code: "600002",
		dealAmount: 3_000_000,
		dealPrice: 7.8,
		name: "齐鲁石化",
		premiumPct: -0.5,
		seller: "营业部D",
		tradeDate: "2023-06-01",
	}),
];

function tradeDates(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card 大宗交易 and shows each trade's name", () => {
	const { getByText } = render(<BlockTradesTable data={ROWS} />);
	expect(getByText("大宗交易")).toBeDefined();
	expect(getByText("3 笔")).toBeDefined();
	expect(getByText("浦发银行")).toBeDefined();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<BlockTradesTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "成交额" });
	fireEvent.click(header); // desc: 12,000,000 / 5,000,000 / 3,000,000
	expect(tradeDates(table)[0]).toBe("2023-06-02");
	fireEvent.click(header); // asc: 3,000,000 / 5,000,000 / 12,000,000
	expect(tradeDates(table)[0]).toBe("2023-06-01");
});

it("has no chart pivot — block trades are discrete events, not a trend", () => {
	const { container } = render(<BlockTradesTable data={ROWS} />);
	expect(within(container).queryByRole("button", { name: "图" })).toBeNull();
});

it("expands a block-trade row to reveal its full detail", () => {
	const { container } = render(<BlockTradesTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 浦发银行 — ¥500.00万
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("成交额")).toBeDefined();
	expect(scope.getByText("¥500.00万")).toBeDefined();
});
