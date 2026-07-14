// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import type { InsiderRowData } from "./finance-schemas-fe15";
import { InsiderTable } from "./insider-table";

// Render-level tests for `insider_trades` on the DataTable primitive (Phase
// 1 Batch B2). jsdom lacks ResizeObserver (recharts' ResponsiveContainer
// needs it) and matchMedia; stubbed as in statements-table.test.tsx / the
// exemplar this batch copies.
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

function insiderRow(
	overrides: Partial<InsiderRowData> & { changeDate: string }
): InsiderRowData {
	return {
		avgPrice: null,
		changeAmount: null,
		changeRatio: null,
		changeShares: null,
		code: "",
		holdType: "",
		name: "",
		person: "",
		position: "",
		reason: "",
		relatedExec: "",
		...overrides,
	};
}

// Newest-first, as the tool returns them; |changeShares| deliberately not in
// source order so the sort test observes a real reorder. Only 万科A is a
// reduce (negative changeShares) row, so the 减持 filter narrows to it alone.
const ROWS: InsiderRowData[] = [
	insiderRow({
		avgPrice: 12.3,
		changeAmount: 246_000,
		changeDate: "2023-05-01",
		changeShares: 20_000,
		code: "000001",
		name: "平安银行",
		person: "张三",
		position: "董事",
		reason: "增持计划",
	}),
	insiderRow({
		avgPrice: 8.5,
		changeAmount: -850_000,
		changeDate: "2023-05-02",
		changeShares: -100_000,
		code: "000002",
		name: "万科A",
		person: "李四",
		position: "监事",
		reason: "减持计划",
	}),
	insiderRow({
		avgPrice: 30.1,
		changeAmount: 1_505_000,
		changeDate: "2023-05-03",
		changeShares: 50_000,
		code: "000003",
		name: "招商银行",
		person: "王五",
		position: "高管",
		reason: "增持计划",
	}),
];

function changeDates(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card 高管/股东增减持 and shows each name + direction", () => {
	const { container, getByText } = render(<InsiderTable data={ROWS} />);
	expect(getByText("高管/股东增减持")).toBeDefined();
	expect(getByText("3 笔")).toBeDefined();
	expect(getByText("平安银行")).toBeDefined();
	const table = container.querySelector("table") as HTMLElement;
	const wankeRow = within(table).getAllByRole("row")[2] as HTMLElement;
	expect(within(wankeRow).getByText("减持")).toBeDefined();
});

it("narrows rows when the 减持 filter is selected", () => {
	const { container } = render(<InsiderTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "减持" }));
	const table = container.querySelector("table") as HTMLElement;
	expect(changeDates(table)).toEqual(["2023-05-02"]);
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<InsiderTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "变动股数" });
	fireEvent.click(header); // desc by |changeShares|: 100,000 / 50,000 / 20,000
	expect(changeDates(table)[0]).toBe("2023-05-02");
	fireEvent.click(header); // asc: 20,000 / 50,000 / 100,000
	expect(changeDates(table)[0]).toBe("2023-05-01");
});

it("has no chart pivot — insider changes are discrete events, not a trend", () => {
	const { container } = render(<InsiderTable data={ROWS} />);
	expect(within(container).queryByRole("button", { name: "图" })).toBeNull();
});

it("expands an insider-trade row to reveal its full detail", () => {
	const { container } = render(<InsiderTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 平安银行 — ¥24.60万
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("变动金额")).toBeDefined();
	expect(scope.getByText("¥24.60万")).toBeDefined();
});
