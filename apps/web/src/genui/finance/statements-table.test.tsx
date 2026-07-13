// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import type { StatementRowData } from "./finance-schemas";
import { StatementsTable } from "./statements-table";

// Render-level tests for the flagship financial_statements DataTable (design
// doc §8.1's worked example). jsdom lacks ResizeObserver (recharts'
// ResponsiveContainer needs it) and matchMedia; stubbed as in
// data-table.test.tsx. Follows option-chain.test.tsx's `within(container)` +
// `.toBeDefined()` convention (no jest-dom matchers configured).
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

const BASE_ROW: StatementRowData = {
	cash: null,
	debtRatio: null,
	financingCashflow: null,
	investingCashflow: null,
	netCashChange: null,
	netProfit: null,
	netProfitDeducted: null,
	operatingCashflow: null,
	operatingCost: null,
	operatingProfit: null,
	reportDate: "",
	revenue: null,
	totalAssets: null,
	totalEquity: null,
	totalLiabilities: null,
	totalProfit: null,
};

function incomeRow(
	overrides: Partial<StatementRowData> & { reportDate: string }
): StatementRowData {
	return { ...BASE_ROW, ...overrides };
}

// Newest-first, as the tool returns them: two annual reports (12-31) and one
// quarterly (09-30) interleaved between them.
const ROWS: StatementRowData[] = [
	incomeRow({
		netProfit: 120,
		operatingCost: 300,
		operatingProfit: 150,
		reportDate: "2023-12-31",
		revenue: 500,
		totalProfit: 140,
	}),
	incomeRow({
		netProfit: 90,
		operatingCost: 250,
		operatingProfit: 120,
		reportDate: "2023-09-30",
		revenue: 400,
		totalProfit: 110,
	}),
	incomeRow({
		netProfit: 60,
		operatingCost: 200,
		operatingProfit: 90,
		reportDate: "2022-12-31",
		revenue: 300,
		totalProfit: 80,
	}),
];

function reportDates(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("detects the income statement kind and titles the card 利润表", () => {
	const { getByText } = render(<StatementsTable data={ROWS} />);
	expect(getByText("利润表")).toBeDefined();
});

it("renders a metric chip for each line item", () => {
	const { container } = render(<StatementsTable data={ROWS} />);
	const scope = within(container);
	// `pressed` disambiguates the metric chip (aria-pressed) from the
	// same-labelled sortable header button (no aria-pressed), per
	// data-table.test.tsx's convention. The first metric is chip-selected by
	// default; the rest are present but unselected.
	expect(
		scope.getByRole("button", { name: "营业收入", pressed: true })
	).toBeDefined();
	expect(
		scope.getByRole("button", { name: "归母净利润", pressed: false })
	).toBeDefined();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<StatementsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "营业收入" });
	fireEvent.click(header); // desc: 500, 400, 300
	expect(reportDates(table)[0]).toBe("2023-12-31");
	fireEvent.click(header); // asc: 300, 400, 500
	expect(reportDates(table)[0]).toBe("2022-12-31");
});

it("pivots to the chart view and plots the selected series", async () => {
	const { container } = render(<StatementsTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	// DataTableChart is React.lazy-loaded; findByLabelText retries until the
	// chunk resolves past the Suspense fallback.
	expect(await within(container).findByLabelText("趋势图")).toBeDefined();
	expect(container.querySelector("table")).toBeNull();
});

it("expands a period row to reveal its full detail", () => {
	const { container } = render(<StatementsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow);
	// The expand <tr> is inserted immediately after the row it expands, not
	// appended at the table's end.
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("营业收入")).toBeDefined();
	// 500 → formatCompact renders as "500.00" below the 万 threshold.
	expect(scope.getByText("500.00")).toBeDefined();
});

it("narrows rows to annual reports via the Period control", () => {
	const { container } = render(<StatementsTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "年报" }));
	const table = container.querySelector("table") as HTMLElement;
	const dates = reportDates(table);
	expect(dates).toContain("2023-12-31");
	expect(dates).toContain("2022-12-31");
	expect(dates).not.toContain("2023-09-30");
});
