// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { SuspensionRowData } from "./finance-schemas-fe15";
import { SuspensionTable } from "./suspension-table";

// Render-level tests for `suspension` on the DataTable primitive (Phase 1
// Batch B3). SuspensionRowSchema carries no numeric field at all, so — like
// top_holders/convertible_bonds — no column is `isMetric` or sortable: no
// Pivot chart and no sortable header, so no recharts import ever loads and
// the ResizeObserver/matchMedia stubs those tests need aren't required here
// (mirrors top-holders-table.test.tsx / forecast-table.test.tsx).

function suspensionRow(
	overrides: Partial<SuspensionRowData> & { suspendStart: string }
): SuspensionRowData {
	return {
		code: "",
		expire: null,
		name: "",
		predictResume: null,
		reason: null,
		suspendEnd: null,
		...overrides,
	};
}

const ROWS: SuspensionRowData[] = [
	suspensionRow({
		code: "600001",
		expire: "预计1天",
		name: "某某股份",
		predictResume: "2026-07-09",
		reason: "重大事项",
		suspendEnd: null,
		suspendStart: "2026-07-08",
	}),
	suspensionRow({
		code: "600002",
		expire: "预计停牌不超过5个交易日",
		name: "另某股份",
		predictResume: null,
		reason: "筹划重大资产重组事项",
		suspendEnd: "2026-07-10",
		suspendStart: "2026-07-07",
	}),
];

it("titles the card 停复牌 and shows each name + start date", () => {
	const { getByText } = render(<SuspensionTable data={ROWS} />);
	expect(getByText("停复牌")).toBeDefined();
	expect(getByText("2 笔")).toBeDefined();
	expect(getByText("某某股份")).toBeDefined();
	expect(getByText("2026-07-08")).toBeDefined();
});

it("has no Pivot chart toggle (no numeric field on SuspensionRowSchema)", () => {
	const { queryByRole } = render(<SuspensionTable data={ROWS} />);
	expect(queryByRole("button", { name: "图" })).toBeNull();
});

it("has no sortable column headers", () => {
	const { container } = render(<SuspensionTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	expect(within(table).queryAllByRole("button").length).toBe(0);
});

it("expands a suspension row to reveal its full 原因 detail", () => {
	const { container } = render(<SuspensionTable data={ROWS} />);
	const table = container.querySelector("table") as HTMLElement;
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow); // 某某股份 — 重大事项
	const expandedRow = within(table).getAllByRole("row")[2] as HTMLElement;
	const scope = within(expandedRow);
	expect(scope.getByText("原因")).toBeDefined();
	expect(scope.getByText("重大事项")).toBeDefined();
});
