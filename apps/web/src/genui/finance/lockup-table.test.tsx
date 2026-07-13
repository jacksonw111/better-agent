// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import type { LockupRowData } from "./finance-schemas-fe13";
import { LockupTable } from "./lockup-table";

// Render-level tests for `lockup` on the DataTable primitive (Phase 1 Batch
// B3). jsdom lacks ResizeObserver (recharts' ResponsiveContainer needs it)
// and matchMedia; stubbed as in insider-table.test.tsx / the exemplar this
// batch copies (lockup has an `isMetric` 解禁市值 column, so its Pivot chart
// is reachable, unlike this batch's other two tools).
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

function lockupRow(
	overrides: Partial<LockupRowData> & { freeDate: string }
): LockupRowData {
	return {
		code: "",
		freeRatio: null,
		freeShares: null,
		liftMarketCap: null,
		name: "",
		type: "",
		...overrides,
	};
}

// Source order deliberately not sorted by 解禁市值, so the sort test observes
// a real reorder.
const ROWS: LockupRowData[] = [
	lockupRow({
		code: "600519",
		freeDate: "2026-08-15",
		freeRatio: 5.2,
		freeShares: 12_000_000,
		liftMarketCap: 2_100_000_000,
		name: "贵州茅台",
		type: "首发原股东限售股份",
	}),
	lockupRow({
		code: "000002",
		freeDate: "2026-08-20",
		freeRatio: 1.1,
		freeShares: 3_000_000,
		liftMarketCap: 500_000_000,
		name: "万科A",
		type: "定向增发机构配售股份",
	}),
	lockupRow({
		code: "300750",
		freeDate: "2026-08-25",
		freeRatio: 8.4,
		freeShares: 20_000_000,
		liftMarketCap: 4_800_000_000,
		name: "宁德时代",
		type: "首发原股东限售股份",
	}),
];

function freeDates(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card 限售解禁 and shows each name", () => {
	const { getByText } = render(<LockupTable data={ROWS} />);
	expect(getByText("限售解禁")).toBeDefined();
	expect(getByText("3 笔")).toBeDefined();
	expect(getByText("贵州茅台")).toBeDefined();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<LockupTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "解禁市值" });
	fireEvent.click(header); // desc: 48亿(300750) / 21亿(600519) / 5亿(000002)
	expect(freeDates(table)[0]).toBe("2026-08-25");
	fireEvent.click(header); // asc: 5亿(000002) / 21亿(600519) / 48亿(300750)
	expect(freeDates(table)[0]).toBe("2026-08-20");
});

it("pivots to the chart view and plots the selected series", async () => {
	const { container } = render(<LockupTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	// DataTableChart is React.lazy-loaded; findByLabelText retries until the
	// chunk resolves past the Suspense fallback.
	expect(await within(container).findByLabelText("趋势图")).toBeDefined();
	expect(container.querySelector("table")).toBeNull();
});

it("expands a lockup row to reveal its 解禁市值 detail", () => {
	const { container } = render(<LockupTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 贵州茅台 — ¥21.00亿
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("解禁市值")).toBeDefined();
	expect(scope.getByText("¥21.00亿")).toBeDefined();
});
