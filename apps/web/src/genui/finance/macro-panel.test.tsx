// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MacroResultData } from "./finance-schemas-fe7";
import { MacroPanel } from "./macro-panel";

// Render-level tests for the macro-panel dispatcher (finance_macro_us /
// finance_macro_cn): each of the three MacroResultSchema branches must route
// to its archetype — dashboard → StatPanel, observations → LineSeries, rows →
// DataTable — none of which is a bespoke recharts panel any more (see
// macro-panel.tsx). Same recharts stub convention as holder-count-chart.test.
// tsx / data-table.test.tsx — jsdom's zero-size layout means recharts never
// lays out real ticks, so these assert on wiring, not recharts' own layout.
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	return {
		...actual,
		Area: ({ fillOpacity, name }: { fillOpacity?: number; name?: string }) => (
			<div data-fill-opacity={fillOpacity ?? 0} data-testid="area">
				{name}
			</div>
		),
		AreaChart: ({ children }: { children?: ReactNode }) => (
			<div>{children}</div>
		),
		Bar: () => null,
		BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
		CartesianGrid: () => null,
		Line: () => null,
		LineChart: ({ children }: { children?: ReactNode }) => (
			<div>{children}</div>
		),
		ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
			<div>{children}</div>
		),
		Tooltip: () => <div data-testid="tooltip" />,
		XAxis: () => null,
		YAxis: () => null,
	};
});

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

function firstCellValues(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows.map(
		(row) => within(row).queryAllByRole("cell")[0]?.textContent ?? ""
	);
}

const DASHBOARD_DATA: MacroResultData = {
	dashboard: [
		{ indicator: "cpi", latest: { time: "2026年06月份", yoy: 2.1 } },
		{ indicator: "unemployment", value: 3.7 },
	],
};

const OBSERVATIONS_DATA: MacroResultData = {
	indicator: "cpi",
	observations: [
		{ date: "2026-05-01", value: 310.1 },
		{ date: "2026-06-01", value: 311.5 },
	],
	seriesId: "CPIAUCSL",
};

const CN_ROWS_DATA: MacroResultData = {
	indicator: "cpi",
	rows: [
		{ mom: 0.3, time: "2026年06月份", yoy: 2.1 },
		{ mom: 0.2, time: "2026年05月份", yoy: 1.5 },
	],
};

it("dashboard branch renders a StatPanel grid with one item per indicator", () => {
	const { getByText } = render(<MacroPanel data={DASHBOARD_DATA} />);
	// CPI's dashboard row picks its `yoy` field (formatPct → signed %).
	expect(getByText("CPI")).toBeDefined();
	expect(getByText("+2.10%")).toBeDefined();
	// unemployment (US shape) has no `latest`, falls back to `value`.
	expect(getByText("失业率")).toBeDefined();
	expect(getByText("3.70")).toBeDefined();
});

it("observations branch renders a LineSeries chart that pivots to a table", async () => {
	const { container } = render(<MacroPanel data={OBSERVATIONS_DATA} />);
	const areas = await within(container).findAllByTestId("area");
	expect(areas).toHaveLength(1);
	fireEvent.click(within(container).getByRole("button", { name: "表" }));
	const table = container.querySelector("table") as HTMLElement;
	expect(within(table).queryByText("日期")).not.toBeNull();
	expect(within(table).queryByText("数值")).not.toBeNull();
	expect(within(table).queryByText("311.50")).not.toBeNull();
});

it("rows branch renders a sortable DataTable built from the row's own fields", () => {
	const { container } = render(<MacroPanel data={CN_ROWS_DATA} />);
	const table = container.querySelector("table") as HTMLElement;
	expect(within(table).queryByText("同比")).not.toBeNull();
	expect(within(table).queryByText("环比")).not.toBeNull();
	const header = within(table).getByRole("button", { name: "同比" });
	fireEvent.click(header); // desc: 2.1 (06月), 1.5 (05月)
	expect(firstCellValues(table)[0]).toBe("2026年06月份");
	fireEvent.click(header); // asc: 1.5 (05月), 2.1 (06月)
	expect(firstCellValues(table)[0]).toBe("2026年05月份");
});

it("returns nothing when the union carries none of dashboard/observations/rows", () => {
	const { container } = render(<MacroPanel data={{}} />);
	expect(container.firstChild).toBeNull();
});

const RECHARTS_IMPORT_RE = /from\s+["']recharts["']/;
const RECHARTS_REQUIRE_RE = /require\(\s*["']recharts["']\s*\)/;

describe("no macro file imports recharts eagerly", () => {
	const MACRO_DIR = dirname(fileURLToPath(import.meta.url));
	const MACRO_FILES = [
		"macro-panel.tsx",
		"macro-series.tsx",
		"macro-cn-table.tsx",
		"macro-dashboard.tsx",
		"macro-fields.tsx",
	];

	it.each(MACRO_FILES)("%s has no static recharts import", (file) => {
		const source = readFileSync(join(MACRO_DIR, file), "utf8");
		expect(source).not.toMatch(RECHARTS_IMPORT_RE);
		expect(source).not.toMatch(RECHARTS_REQUIRE_RE);
	});
});
