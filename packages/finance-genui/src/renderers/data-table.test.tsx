// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { DataTable } from "./data-table";
import type { DataTableColumn, DataTableProps } from "./data-table-types";

// jsdom's zero-size layout means recharts never lays out real ticks (its
// ResponsiveContainer measures 0×0 via getBoundingClientRect), so the axis/
// tooltip formatter tests below stub the handful of recharts primitives
// data-table-chart.tsx uses and invoke the `tickFormatter`/`labelFormatter`
// props it wires up directly — this asserts the wiring, not recharts' own
// layout engine.
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	return {
		...actual,
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
		Tooltip: ({
			labelFormatter,
		}: {
			labelFormatter?: (raw: string) => ReactNode;
		}) => (
			<div data-testid="chart-tooltip-label">{labelFormatter?.("2023")}</div>
		),
		XAxis: ({ tickFormatter }: { tickFormatter?: (raw: string) => string }) => (
			<div data-testid="chart-xaxis-tick">
				{tickFormatter ? tickFormatter("2023") : "2023"}
			</div>
		),
		YAxis: () => null,
	};
});

// jsdom lacks ResizeObserver (recharts' ResponsiveContainer needs it) and
// matchMedia; the latter also lets us pin prefers-reduced-motion so the kit's
// chip/segment spring "pop" (a 3-keyframe spring, unsupported off-DOM) doesn't
// throw an unhandled frameloop error mid-assert. Neither affects the behavior
// under test — sort/filter/series/pivot/expand are all pure client state.
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

// Render-level tests for the DataTable primitive over a SYNTHETIC statements-
// shaped payload: rows = reporting periods, columns = revenue/netProfit
// metrics + a `period` categoryKey. Follows option-chain.test.tsx's
// `within(container)` convention (no jest-dom matchers configured); the
// `pressed` role filter disambiguates the metric chip (has aria-pressed) from
// the same-labelled sortable header button (has none).

const YEAR_RE = /^\d{4}$/;

interface Row {
	kind: "annual" | "quarter";
	netProfit: number;
	period: string;
	revenue: number | null;
}

const ROWS: Row[] = [
	{ kind: "annual", netProfit: 50, period: "2023", revenue: 300 },
	{ kind: "annual", netProfit: 40, period: "2022", revenue: null },
	{ kind: "quarter", netProfit: 30, period: "2021", revenue: 100 },
	{ kind: "annual", netProfit: 20, period: "2020", revenue: 200 },
];

const COLUMNS: DataTableColumn<Row>[] = [
	{ key: "period", label: "报告期", render: (r) => r.period },
	{
		align: "right",
		isMetric: true,
		key: "revenue",
		label: "营收",
		render: (r) => (r.revenue === null ? "—" : String(r.revenue)),
		value: (r) => r.revenue,
	},
	{
		align: "right",
		isMetric: true,
		key: "netProfit",
		label: "净利润",
		render: (r) => String(r.netProfit),
		value: (r) => r.netProfit,
	},
];

function renderTable(overrides: Partial<DataTableProps<Row>> = {}) {
	return render(
		<DataTable<Row>
			categoryKey="period"
			columns={COLUMNS}
			filterMode="multi"
			filters={[
				{ id: "annual", label: "年报", predicate: (r) => r.kind === "annual" },
				{
					id: "quarter",
					label: "季报",
					predicate: (r) => r.kind === "quarter",
				},
			]}
			getRowKey={(r) => r.period}
			renderExpanded={(r) => <div>{`明细净利润 ${r.netProfit}`}</div>}
			rows={ROWS}
			title="财务报表"
			{...overrides}
		/>
	);
}

function dataRowPeriods(table: HTMLElement): string[] {
	const rows = within(table).getAllByRole("row").slice(1);
	return rows
		.map((row) => within(row).queryAllByRole("cell")[0]?.textContent ?? "")
		.filter((text) => YEAR_RE.test(text));
}

it("sorts numerically on a header click, nulls last, and toggles direction", () => {
	const { container } = renderTable();
	const table = container.querySelector("table") as HTMLElement;
	expect(dataRowPeriods(table)[0]).toBe("2023"); // source order

	const header = within(table).getByRole("button", { name: "营收" });
	fireEvent.click(header); // desc: 300, 200, 100, null-last
	const desc = dataRowPeriods(table);
	expect(desc[0]).toBe("2023");
	expect(desc.at(-1)).toBe("2022"); // null revenue sinks to the bottom

	fireEvent.click(header); // asc: 100, 200, 300, null-last
	expect(dataRowPeriods(table)[0]).toBe("2021");
});

it("narrows rows when a filter chip is toggled", () => {
	const { container } = renderTable();
	const annual = within(container).getByRole("button", { name: "年报" });
	fireEvent.click(annual);
	const table = container.querySelector("table") as HTMLElement;
	const periods = dataRowPeriods(table);
	expect(periods).toContain("2023");
	expect(periods).not.toContain("2021"); // the only 季报 row is filtered out
});

it("selects metrics (min 1 floor) that drive the chart series", () => {
	const { container } = renderTable();
	const scope = within(container);
	// First metric is selected by default; the second is not.
	expect(
		scope.getByRole("button", { name: "营收", pressed: true })
	).toBeDefined();
	const netProfit = scope.getByRole("button", {
		name: "净利润",
		pressed: false,
	});
	fireEvent.click(netProfit); // Compare: both series now selected
	expect(
		scope.getByRole("button", { name: "净利润", pressed: true })
	).toBeDefined();

	// Deselecting the last-standing metric is refused (min 1).
	const revenue = scope.getByRole("button", { name: "营收", pressed: true });
	fireEvent.click(netProfit); // back to revenue only
	fireEvent.click(revenue);
	expect(
		scope.getByRole("button", { name: "营收", pressed: true })
	).toBeDefined();
});

it("pivots between the table grid and the chart view", async () => {
	const { container } = renderTable();
	expect(container.querySelector("table")).not.toBeNull();
	const toChart = within(container).getByRole("button", { name: "图" });
	fireEvent.click(toChart);
	// DataTableChart is React.lazy-loaded (recharts must not ship in the
	// eager table-view bundle), so the chart chunk resolves asynchronously —
	// findByLabelText retries until the Suspense fallback settles.
	expect(await within(container).findByLabelText("趋势图")).toBeDefined();
	expect(container.querySelector("table")).toBeNull();

	const toTable = within(container).getByRole("button", { name: "表" });
	fireEvent.click(toTable);
	expect(container.querySelector("table")).not.toBeNull();
});

it("applies categoryFormat to the chart axis tick and tooltip label", async () => {
	const categoryFormat = (raw: string) => `FY${raw}`;
	const { container } = renderTable({ categoryFormat });
	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	const scope = within(container);
	expect(await scope.findByTestId("chart-xaxis-tick")).toBeDefined();
	expect(scope.getByTestId("chart-xaxis-tick").textContent).toBe("FY2023");
	expect(scope.getByTestId("chart-tooltip-label").textContent).toBe("FY2023");
});

it("falls back to the raw category string when categoryFormat is omitted", async () => {
	const { container } = renderTable();
	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	const scope = within(container);
	expect(await scope.findByTestId("chart-xaxis-tick")).toBeDefined();
	expect(scope.getByTestId("chart-xaxis-tick").textContent).toBe("2023");
	expect(scope.getByTestId("chart-tooltip-label").textContent).toBe("2023");
});

it("expands a row inline to reveal its detail", () => {
	const { container } = renderTable();
	const table = container.querySelector("table") as HTMLElement;
	const scope = within(container);
	expect(scope.queryByText("明细净利润 50")).toBeNull();
	const firstRow = within(table).getAllByRole("row")[1] as HTMLElement;
	fireEvent.click(firstRow);
	expect(scope.getByText("明细净利润 50")).toBeDefined();
});
