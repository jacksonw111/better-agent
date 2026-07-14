// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { BarSeries } from "./bar-series";
import type { BarSeriesProps } from "./bar-series-types";
import type { FinTableColumn } from "./primitives";

// jsdom's zero-size layout means recharts never lays out real ticks (its
// ResponsiveContainer measures 0×0 via getBoundingClientRect), so this stubs
// the handful of recharts primitives bar-series-chart.tsx uses — same
// approach as data-table.test.tsx — and asserts on the props (fill/name/
// children) BarSeriesChart wires up, not recharts' own layout engine.
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	return {
		...actual,
		Bar: ({
			children,
			fill,
			name,
		}: {
			children?: ReactNode;
			fill?: string;
			name?: string;
		}) => (
			<div data-fill={fill ?? ""} data-testid="bar">
				{name}
				{children}
			</div>
		),
		BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
		CartesianGrid: () => null,
		Cell: ({ fill }: { fill?: string }) => (
			<span data-fill={fill} data-testid="cell" />
		),
		ReferenceLine: () => null,
		ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
			<div>{children}</div>
		),
		Tooltip: () => <div data-testid="tooltip" />,
		XAxis: () => null,
		YAxis: () => null,
	};
});

// jsdom lacks ResizeObserver (recharts' ResponsiveContainer needs it) and
// matchMedia; the latter also pins prefers-reduced-motion so the kit's chip/
// segment spring "pop" doesn't throw an unhandled frameloop error mid-assert.
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

interface Row {
	bucketA: number;
	bucketB: number;
	bucketC: number;
	bucketD: number;
	date: string;
}

const ROWS: Row[] = [
	{ bucketA: 10, bucketB: -5, bucketC: 2, bucketD: -1, date: "2024-01-01" },
	{ bucketA: -8, bucketB: 6, bucketC: -3, bucketD: 4, date: "2024-01-02" },
];

const TABLE_COLUMNS: FinTableColumn<Row>[] = [
	{ key: "date", label: "日期", render: (r) => r.date },
	{
		align: "right",
		key: "bucketA",
		label: "A",
		render: (r) => String(r.bucketA),
	},
];

function renderBarSeries(overrides: Partial<BarSeriesProps<Row>> = {}) {
	return render(
		<BarSeries<Row>
			categoryKey="date"
			coloring="composition"
			getRowKey={(r) => r.date}
			rows={ROWS}
			series={[
				{ key: "bucketA", label: "A" },
				{ key: "bucketB", label: "B" },
				{ key: "bucketC", label: "C" },
				{ key: "bucketD", label: "D" },
			]}
			tableColumns={TABLE_COLUMNS}
			title="测试资金流"
			{...overrides}
		/>
	);
}

it("colors composition series with distinct hues, not all one color", async () => {
	const { container } = renderBarSeries();
	const bars = await within(container).findAllByTestId("bar");
	expect(bars).toHaveLength(4);
	const fills = bars.map((b) => b.getAttribute("data-fill"));
	expect(new Set(fills).size).toBe(4);
});

it("hides a bucket when its Filter chip is toggled off", async () => {
	const { container } = renderBarSeries();
	await within(container).findAllByTestId("bar");
	const chipB = within(container).getByRole("button", {
		name: "B",
		pressed: true,
	});
	fireEvent.click(chipB);
	const bars = within(container).getAllByTestId("bar");
	expect(bars).toHaveLength(3);
	expect(bars.some((b) => b.textContent === "B")).toBe(false);
});

it("switches an isolated bucket from composition to sign coloring", async () => {
	const { container } = renderBarSeries();
	await within(container).findAllByTestId("bar");
	for (const label of ["B", "C", "D"]) {
		fireEvent.click(
			within(container).getByRole("button", { name: label, pressed: true })
		);
	}
	const bars = within(container).getAllByTestId("bar");
	expect(bars).toHaveLength(1);
	const cells = within(bars[0] as HTMLElement).getAllByTestId("cell");
	expect(cells).toHaveLength(ROWS.length);
	const fills = cells.map((c) => c.getAttribute("data-fill"));
	expect(new Set(fills).size).toBeGreaterThan(1); // sign varies per row now
});

it("narrows rows via Period in the table view", () => {
	const periods = [
		{
			id: "d1",
			label: "01-01",
			predicate: (r: Row) => r.date === "2024-01-01",
		},
		{
			id: "d2",
			label: "01-02",
			predicate: (r: Row) => r.date === "2024-01-02",
		},
	];
	const { container } = renderBarSeries({ defaultView: "table", periods });
	const table = container.querySelector("table") as HTMLElement;
	expect(within(table).queryByText("2024-01-01")).not.toBeNull();
	expect(within(table).queryByText("2024-01-02")).toBeNull();

	fireEvent.click(within(container).getByRole("button", { name: "01-02" }));
	expect(within(table).queryByText("2024-01-02")).not.toBeNull();
	expect(within(table).queryByText("2024-01-01")).toBeNull();
});

it("pivots between the chart and table view", async () => {
	const { container } = renderBarSeries();
	expect(await within(container).findAllByTestId("bar")).toHaveLength(4);
	expect(container.querySelector("table")).toBeNull();

	fireEvent.click(within(container).getByRole("button", { name: "表" }));
	expect(container.querySelector("table")).not.toBeNull();

	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	expect(await within(container).findAllByTestId("bar")).toHaveLength(4);
});

it("renders a themed tooltip for Inspect", async () => {
	const { container } = renderBarSeries();
	expect(await within(container).findByTestId("tooltip")).toBeDefined();
});
