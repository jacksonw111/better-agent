// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import type { IndicatorRowData } from "./finance-schemas";
import { IndicatorsTable } from "./indicators-table";

// Render-level tests for `financial_indicators` on the DataTable primitive
// (Phase 1 Batch B1). jsdom lacks ResizeObserver (recharts' ResponsiveContainer
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

const BASE_ROW: IndicatorRowData = {
	bps: null,
	debtRatio: null,
	eps: null,
	grossMargin: null,
	netMargin: null,
	netProfit: null,
	netProfitYoy: null,
	opCashPerShare: null,
	reportDate: "",
	reportName: null,
	revenue: null,
	revenueYoy: null,
	roe: null,
	roeDeducted: null,
};

function indicatorRow(
	overrides: Partial<IndicatorRowData> & { reportDate: string }
): IndicatorRowData {
	return { ...BASE_ROW, ...overrides };
}

// Newest-first, as the tool returns them.
const ROWS: IndicatorRowData[] = [
	indicatorRow({
		netProfit: 120,
		reportDate: "2023-12-31",
		reportName: "2023年报",
		revenue: 500,
		revenueYoy: 12.3,
	}),
	indicatorRow({
		netProfit: 90,
		reportDate: "2023-09-30",
		reportName: "2023三季报",
		revenue: 400,
		revenueYoy: 8.1,
	}),
	indicatorRow({
		netProfit: 60,
		reportDate: "2022-12-31",
		reportName: "2022年报",
		revenue: 300,
		revenueYoy: 5.0,
	}),
];

function reportLabels(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card 财务指标 and shows the reportName label", () => {
	const { getByText } = render(<IndicatorsTable data={ROWS} />);
	expect(getByText("财务指标")).toBeDefined();
	expect(getByText("2023年报")).toBeDefined();
});

it("renders a metric chip for each numeric column", () => {
	const { container } = render(<IndicatorsTable data={ROWS} />);
	const scope = within(container);
	expect(
		scope.getByRole("button", { name: "营收", pressed: true })
	).toBeDefined();
	expect(
		scope.getByRole("button", { name: "归母净利", pressed: false })
	).toBeDefined();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<IndicatorsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "营收" });
	fireEvent.click(header); // desc: 500, 400, 300
	expect(reportLabels(table)[0]).toBe("2023年报");
	fireEvent.click(header); // asc: 300, 400, 500
	expect(reportLabels(table)[0]).toBe("2022年报");
});

it("pivots to the chart view and plots the selected series", () => {
	const { container } = render(<IndicatorsTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	expect(within(container).getByLabelText("趋势图")).toBeDefined();
	expect(container.querySelector("table")).toBeNull();
});

it("expands a period row to reveal its full detail", () => {
	const { container } = render(<IndicatorsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow);
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("营收")).toBeDefined();
	// 500 → formatCompact renders as "500.00" below the 万 threshold.
	expect(scope.getByText("500.00")).toBeDefined();
});
