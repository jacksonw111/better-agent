// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { HolderRowData } from "./finance-schemas";
import { TopHoldersTable } from "./top-holders-table";

// Render-level tests for `top_holders` on the DataTable primitive (Phase 1
// Batch B2). Unlike statements/indicators/dividends, `holder` (a shareholder
// name) isn't date/number-orderable, so no column is `isMetric` — there's no
// Pivot chart, so (unlike those exemplars) no recharts import ever loads and
// the ResizeObserver/matchMedia stubs those tests need aren't required here
// (mirrors forecast-table.test.tsx, the other no-Pivot DataTable tool).

function holderRow(
	overrides: Partial<HolderRowData> & { holder: string }
): HolderRowData {
	return {
		changeRatio: null,
		changeShares: null,
		endDate: "2023-12-31",
		freeFloatRatio: null,
		isInstitution: false,
		rank: null,
		shares: null,
		...overrides,
	};
}

// Source order deliberately not sorted by 持股数, so the sort test observes
// a real reorder.
const ROWS: HolderRowData[] = [
	holderRow({
		freeFloatRatio: 18.4,
		holder: "股东乙",
		rank: 2,
		shares: 800_000,
	}),
	holderRow({
		freeFloatRatio: 23.1,
		holder: "股东甲",
		isInstitution: true,
		rank: 1,
		shares: 1_000_000,
	}),
	holderRow({
		changeRatio: -0.2,
		changeShares: -2000,
		freeFloatRatio: 10,
		holder: "股东丙",
		rank: 3,
		shares: 500_000,
	}),
];

function holderNames(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map((row) => {
		const cell = within(row).queryAllByRole("cell")[1];
		return cell?.querySelector("span[title]")?.textContent ?? "";
	});
}

it("titles the card 十大流通股东 and shows each holder name", () => {
	const { getByText } = render(<TopHoldersTable data={ROWS} />);
	expect(getByText("十大流通股东")).toBeDefined();
	expect(getByText("股东甲")).toBeDefined();
	expect(getByText("机构")).toBeDefined(); // isInstitution badge
});

it("renders a ProportionBar in the 持股占比 cell", () => {
	const { container } = render(<TopHoldersTable data={ROWS} />);
	// valueLabel — confirms the ratio cell renders through ProportionBar
	// (formatRatio), not bare text. Scoped to this render's own container:
	// RTL doesn't auto-cleanup between tests in this file (no test.globals in
	// vitest.config.ts), so an unscoped/document-wide getByText would also
	// match the identical "23.10%" span left behind by an earlier test's
	// still-mounted render of the same ROWS.
	expect(within(container).getByText("23.10%")).toBeDefined();
	const track = container.querySelector(".rounded-full.bg-muted");
	expect(track).toBeDefined();
});

it("has no Pivot chart toggle (no isMetric columns — holder isn't orderable)", () => {
	const { queryByRole } = render(<TopHoldersTable data={ROWS} />);
	expect(queryByRole("button", { name: "图" })).toBeNull();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<TopHoldersTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "持股数" });
	fireEvent.click(header); // desc: 1,000,000 / 800,000 / 500,000
	expect(holderNames(table)[0]).toBe("股东甲");
	fireEvent.click(header); // asc: 500,000 / 800,000 / 1,000,000
	expect(holderNames(table)[0]).toBe("股东丙");
});

it("expands a holder row to reveal its full detail", () => {
	const { container } = render(<TopHoldersTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 股东乙 — 800,000 shares
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("持股数")).toBeDefined();
	expect(scope.getByText("80.00万")).toBeDefined();
});
