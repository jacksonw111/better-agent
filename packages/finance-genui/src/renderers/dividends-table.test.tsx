// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import { DividendsTable } from "./dividends-table";
import type { DividendRowData } from "./finance-schemas";

// Render-level tests for `dividends` on the DataTable primitive (Phase 1
// Batch B1). jsdom lacks ResizeObserver (recharts' ResponsiveContainer needs
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

function dividendRow(
	overrides: Partial<DividendRowData> & {
		plan: string;
		pretaxDividendRmb: number;
		reportDate: string;
	}
): DividendRowData {
	return {
		bonusRatioDividend: null,
		bonusRatioTransfer: null,
		exDividendDate: "",
		noticeDate: "",
		progress: "实施",
		recordDate: "",
		...overrides,
	};
}

// Newest-first, as the tool returns them.
const ROWS: DividendRowData[] = [
	dividendRow({
		plan: "10派5元",
		pretaxDividendRmb: 5,
		reportDate: "2023-12-31",
	}),
	dividendRow({
		plan: "10派3元",
		pretaxDividendRmb: 3,
		reportDate: "2022-12-31",
	}),
	dividendRow({
		plan: "10派8元",
		pretaxDividendRmb: 8,
		reportDate: "2021-12-31",
	}),
];

function reportDates(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card 分红方案 and shows the plan text", () => {
	const { getByText } = render(<DividendsTable data={ROWS} />);
	expect(getByText("分红方案")).toBeDefined();
	expect(getByText("10派5元")).toBeDefined();
});

it("offers a chart pivot but no lone metric chip (single metric is a no-op)", () => {
	const { container } = render(<DividendsTable data={ROWS} />);
	// 税前派息 is the only metric — it always plots, so its chip would be a
	// pointless always-on toggle and is suppressed; the 表/图 Pivot stays.
	// (The sortable column HEADER "税前派息" is a separate, non-pressed button.)
	expect(within(container).getByRole("button", { name: "图" })).toBeDefined();
	expect(
		within(container).queryByRole("button", { name: "税前派息", pressed: true })
	).toBeNull();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<DividendsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "税前派息" });
	fireEvent.click(header); // desc: 8, 5, 3
	expect(reportDates(table)[0]).toBe("2021-12-31");
	fireEvent.click(header); // asc: 3, 5, 8
	expect(reportDates(table)[0]).toBe("2022-12-31");
});

it("pivots to the chart view and plots the selected series", async () => {
	const { container } = render(<DividendsTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	// DataTableChart is React.lazy-loaded; findByLabelText retries until the
	// chunk resolves past the Suspense fallback.
	expect(await within(container).findByLabelText("趋势图")).toBeDefined();
	expect(container.querySelector("table")).toBeNull();
});

it("expands a dividend row to reveal its full detail", () => {
	const { container } = render(<DividendsTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow);
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("税前派息")).toBeDefined();
	expect(scope.getByText("¥5.00")).toBeDefined();
});
