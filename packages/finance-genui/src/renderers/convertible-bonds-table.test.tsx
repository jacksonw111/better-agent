// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ConvertibleBondsTable } from "./convertible-bonds-table";
import type { ConvertibleBondRowData } from "./finance-schemas-fe13";

// Render-level tests for `convertible_bonds` on the DataTable primitive
// (Phase 1 Batch B3). Like top_holders, `code` (a bond identifier, not a
// date/number) is the categoryKey, so no column is `isMetric` — no Pivot
// chart, so no recharts import ever loads and the ResizeObserver/matchMedia
// stubs those tests need aren't required here (mirrors
// top-holders-table.test.tsx / forecast-table.test.tsx).

function bondRow(
	overrides: Partial<ConvertibleBondRowData> & { code: string }
): ConvertibleBondRowData {
	return {
		expireDate: "",
		issuePrice: null,
		issueScale: null,
		listingDate: "",
		name: "",
		rating: "",
		stockCode: "",
		...overrides,
	};
}

// Source order deliberately not sorted by 发行规模, so the sort test observes
// a real reorder. Ratings deliberately kept unique across rows so a plain
// `getByText` on a rating badge doesn't hit more than one match.
const ROWS: ConvertibleBondRowData[] = [
	bondRow({
		code: "113050",
		issueScale: 1_500_000_000,
		listingDate: "2026-02-01",
		name: "浦发转债",
		rating: "AAA",
		stockCode: "600000",
	}),
	bondRow({
		code: "128136",
		issueScale: 500_000_000,
		listingDate: "2026-03-01",
		name: "中环转2",
		rating: "AA+",
		stockCode: "002129",
	}),
	bondRow({
		code: "110081",
		issueScale: 3_000_000_000,
		listingDate: "2026-01-10",
		name: "旗滨转债",
		rating: "AA",
		stockCode: "601636",
	}),
];

function bondCodes(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card 可转债 and shows each bond code/name", () => {
	const { getByText } = render(<ConvertibleBondsTable data={ROWS} />);
	expect(getByText("可转债")).toBeDefined();
	expect(getByText("浦发转债")).toBeDefined();
	expect(getByText("AAA")).toBeDefined(); // rating badge
});

it("has no Pivot chart toggle (no isMetric columns — code isn't orderable)", () => {
	const { queryByRole } = render(<ConvertibleBondsTable data={ROWS} />);
	expect(queryByRole("button", { name: "图" })).toBeNull();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<ConvertibleBondsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "发行规模" });
	fireEvent.click(header); // desc: 30亿(110081) / 15亿(113050) / 5亿(128136)
	expect(bondCodes(table)[0]).toBe("110081");
	fireEvent.click(header); // asc: 5亿 / 15亿 / 30亿
	expect(bondCodes(table)[0]).toBe("128136");
});

it("expands a bond row to reveal its full detail", () => {
	const { container } = render(<ConvertibleBondsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 浦发转债 — 600000
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("正股代码")).toBeDefined();
	expect(scope.getByText("600000")).toBeDefined();
});
