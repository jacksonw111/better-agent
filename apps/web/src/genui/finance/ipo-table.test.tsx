// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { IpoRowData } from "./finance-schemas-fe13";
import { IpoTable } from "./ipo-table";

// Render-level tests for `ipo` on the DataTable primitive (Phase 1 Batch B4).
// No `isMetric` column (see ipo-columns.tsx), so no Pivot chart ever mounts
// and the ResizeObserver/matchMedia stubs those tests need aren't required
// here (mirrors forecast-table.test.tsx/suspension-table.test.tsx).

function ipoRow(overrides: Partial<IpoRowData> & { code: string }): IpoRowData {
	return {
		afterPe: null,
		applyCode: "",
		applyDate: "",
		applyUpper: null,
		industryPe: null,
		issuePrice: null,
		listingDate: "",
		market: "",
		name: "",
		...overrides,
	};
}

// Newest applyDate first, as the tool returns them; 发行PE deliberately not
// in source order so the sort test observes a real reorder.
const ROWS: IpoRowData[] = [
	ipoRow({
		afterPe: 32.1,
		applyCode: "301888",
		applyDate: "2026-07-10",
		applyUpper: 15_000,
		code: "301888",
		industryPe: 28.7,
		issuePrice: 25.5,
		listingDate: "2026-07-20",
		market: "创业板",
		name: "新易盛二代",
	}),
	ipoRow({
		afterPe: 18.4,
		applyCode: "688123",
		applyDate: "2026-07-08",
		applyUpper: 8000,
		code: "688123",
		industryPe: 22.1,
		issuePrice: 40.2,
		listingDate: "2026-07-18",
		market: "科创板",
		name: "芯动科技",
	}),
	ipoRow({
		afterPe: 45.9,
		applyCode: "300456",
		applyDate: "2026-07-05",
		applyUpper: 20_000,
		code: "300456",
		industryPe: 30.0,
		issuePrice: 15.8,
		listingDate: "2026-07-15",
		market: "创业板",
		name: "云途软件",
	}),
];

function applyDates(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[2]?.textContent ?? ""
	);
}

it("titles the card 新股申购 and shows each name + board", () => {
	const { getByText } = render(<IpoTable data={ROWS} />);
	expect(getByText("新股申购")).toBeDefined();
	expect(getByText("3 只")).toBeDefined();
	expect(getByText("新易盛二代")).toBeDefined();
	expect(getByText("科创板")).toBeDefined();
});

it("has no Pivot chart toggle (no plottable metric columns)", () => {
	const { queryByRole } = render(<IpoTable data={ROWS} />);
	expect(queryByRole("button", { name: "图" })).toBeNull();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<IpoTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "发行PE" });
	fireEvent.click(header); // desc: 45.9(300456) / 32.1(301888) / 18.4(688123)
	expect(applyDates(table)[0]).toBe("2026-07-05");
	fireEvent.click(header); // asc: 18.4(688123) / 32.1(301888) / 45.9(300456)
	expect(applyDates(table)[0]).toBe("2026-07-08");
});

it("expands an IPO row to reveal its 发行价 detail", () => {
	const { container } = render(<IpoTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 新易盛二代 — 发行价 25.50
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("发行价")).toBeDefined();
	expect(scope.getByText("25.50")).toBeDefined();
});
