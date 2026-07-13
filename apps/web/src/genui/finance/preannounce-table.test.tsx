// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { PreannounceRowData } from "./finance-schemas-fe13";
import { PreannounceTable } from "./preannounce-table";

// Render-level tests for `earnings_preannounce` on the DataTable primitive
// (Phase 1 Batch B4). No `isMetric` column (see preannounce-columns.tsx), so
// no Pivot chart ever mounts and the ResizeObserver/matchMedia stubs those
// tests need aren't required here (mirrors forecast-table.test.tsx).

function preannounceRow(
	overrides: Partial<PreannounceRowData> & { noticeDate: string }
): PreannounceRowData {
	return {
		changeLower: null,
		changeUpper: null,
		code: "",
		content: "",
		name: "",
		reason: "",
		reportDate: "",
		type: "",
		...overrides,
	};
}

// Newest noticeDate first, as the tool returns them; 同比区间 midpoint
// deliberately not in source order so the sort test observes a real reorder.
// Only 招商银行 is 预减, so the 预减 filter narrows to it alone.
const ROWS: PreannounceRowData[] = [
	preannounceRow({
		changeLower: 30,
		changeUpper: 50,
		code: "000001",
		content: "预计净利润同比增长30%-50%",
		name: "平安银行",
		noticeDate: "2026-07-10",
		type: "预增",
	}),
	preannounceRow({
		changeLower: -60,
		changeUpper: -40,
		code: "600036",
		content: "预计净利润同比下降40%-60%",
		name: "招商银行",
		noticeDate: "2026-07-09",
		type: "预减",
	}),
	preannounceRow({
		changeLower: 80,
		changeUpper: 100,
		code: "300750",
		content: "预计净利润同比增长80%-100%",
		name: "宁德时代",
		noticeDate: "2026-07-08",
		type: "预增",
	}),
];

function noticeDates(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

it("titles the card 业绩预告 and shows each name + type", () => {
	const { container, getByText } = render(<PreannounceTable data={ROWS} />);
	expect(getByText("业绩预告")).toBeDefined();
	expect(getByText("3 条")).toBeDefined();
	expect(getByText("平安银行")).toBeDefined();
	const table = container.querySelector("table") as HTMLElement;
	const zhaohangRow = within(table).getAllByRole("row")[2] as HTMLElement;
	expect(within(zhaohangRow).getByText("预减")).toBeDefined();
});

it("narrows rows when the 预减 filter is selected", () => {
	const { container } = render(<PreannounceTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "预减" }));
	const table = container.querySelector("table") as HTMLElement;
	expect(noticeDates(table)).toEqual(["2026-07-09"]);
});

it("has no Pivot chart toggle (no plottable metric columns)", () => {
	const { queryByRole } = render(<PreannounceTable data={ROWS} />);
	expect(queryByRole("button", { name: "图" })).toBeNull();
});

it("sorts rows numerically on a header click", () => {
	const { container } = render(<PreannounceTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const header = within(table).getByRole("button", { name: "同比区间" });
	fireEvent.click(header); // desc by midpoint: 90(300750) / 40(000001) / -50(600036)
	expect(noticeDates(table)[0]).toBe("2026-07-08");
	fireEvent.click(header); // asc: -50(600036) / 40(000001) / 90(300750)
	expect(noticeDates(table)[0]).toBe("2026-07-09");
});

it("expands a preannounce row to reveal its full 预告内容 detail", () => {
	const { container } = render(<PreannounceTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 平安银行 — 预计净利润同比增长30%-50%
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("预告内容")).toBeDefined();
	expect(scope.getByText("预计净利润同比增长30%-50%")).toBeDefined();
});
