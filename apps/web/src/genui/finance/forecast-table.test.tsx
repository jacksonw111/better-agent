// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ForecastRowData } from "./finance-schemas-fe8";
import { ForecastTable } from "./forecast-table";

// Render-level tests for `earnings_forecast` on the DataTable primitive
// (Phase 1 Batch B1). Unlike statements/indicators/dividends, this tool has
// no Pivot chart or row expand (see forecast-table.tsx/forecast-columns.ts
// for why), so those two assertions from the shared test checklist don't
// apply here — only columns/sort/conditional-column coverage remain. No
// recharts import in the render tree, so the ResizeObserver/matchMedia
// stubs the other three tests need aren't required here.

// Ascending, as apps/finance-mcp/src/core/eastmoney/forecast.ts returns them
// (baseYear, +1, +2 — this FY first).
const ROWS: ForecastRowData[] = [
	{ eps: 1.1, pe: 21, revenue: null, year: "2026" },
	{ eps: 1.3, pe: 19, revenue: null, year: "2027" },
	{ eps: 1.5, pe: 17, revenue: null, year: "2028" },
];

const ROWS_WITH_REVENUE: ForecastRowData[] = [
	{ eps: 1.1, pe: 21, revenue: 500, year: "2026" },
	{ eps: 1.3, pe: 19, revenue: 600, year: "2027" },
];

function years(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card and renders one row per fiscal year in tool order", () => {
	const { container, getByText } = render(<ForecastTable data={ROWS} />);
	expect(getByText("盈利预测(一致预期)")).toBeDefined();
	const table = container.querySelector("table") as HTMLElement;
	expect(years(table)).toEqual(["2026", "2027", "2028"]);
});

it("omits the 营收 column when no row carries revenue", () => {
	const { queryByText } = render(<ForecastTable data={ROWS} />);
	expect(queryByText("营收")).toBeNull();
});

it("shows the 营收 column when at least one row carries revenue", () => {
	const { getByText } = render(<ForecastTable data={ROWS_WITH_REVENUE} />);
	expect(getByText("营收")).toBeDefined();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<ForecastTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "EPS" });
	fireEvent.click(header); // desc: 1.5, 1.3, 1.1
	expect(years(table)[0]).toBe("2028");
	fireEvent.click(header); // asc: 1.1, 1.3, 1.5
	expect(years(table)[0]).toBe("2026");
});

it("has no Pivot chart toggle (no plottable metric columns)", () => {
	const { queryByRole } = render(<ForecastTable data={ROWS} />);
	expect(queryByRole("button", { name: "图" })).toBeNull();
});
