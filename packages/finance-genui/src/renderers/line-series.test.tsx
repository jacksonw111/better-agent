// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { LineSeries } from "./line-series";
import type { LineSeriesProps } from "./line-series-types";
import type { FinTableColumn } from "./primitives";

// jsdom's zero-size layout means recharts never lays out real ticks (its
// ResponsiveContainer measures 0×0 via getBoundingClientRect), so this stubs
// the handful of recharts primitives line-series-chart.tsx uses — same
// approach as bar-series.test.tsx — and asserts on the props (stroke/
// fillOpacity/name, and the Tooltip's `formatter` callback) LineSeriesChart
// wires up, not recharts' own layout engine.
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	return {
		...actual,
		Area: ({
			fill,
			fillOpacity,
			name,
			stroke,
		}: {
			fill?: string;
			fillOpacity?: number;
			name?: string;
			stroke?: string;
		}) => (
			<div
				data-fill={fill ?? ""}
				data-fill-opacity={fillOpacity ?? 0}
				data-stroke={stroke ?? ""}
				data-testid="area"
			>
				{name}
			</div>
		),
		AreaChart: ({ children }: { children?: ReactNode }) => (
			<div>{children}</div>
		),
		CartesianGrid: () => null,
		ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
			<div>{children}</div>
		),
		Tooltip: ({
			formatter,
		}: {
			formatter?: (value: unknown, name: unknown) => [string, unknown];
		}) => (
			<div
				data-formatted={formatter ? String(formatter(12_340, "x")[0]) : ""}
				data-testid="tooltip"
			/>
		),
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
	a: number;
	b: number;
	date: string;
}

const ROWS: Row[] = [
	{ a: 10, b: 20, date: "2024-01-01" },
	{ a: 15, b: 18, date: "2024-01-02" },
];

const TABLE_COLUMNS: FinTableColumn<Row>[] = [
	{ key: "date", label: "日期", render: (r) => r.date },
	{ align: "right", key: "a", label: "A", render: (r) => String(r.a) },
];

function renderLineSeries(overrides: Partial<LineSeriesProps<Row>> = {}) {
	return render(
		<LineSeries<Row>
			categoryKey="date"
			getRowKey={(r) => r.date}
			rows={ROWS}
			series={[
				{ key: "a", label: "A" },
				{ key: "b", label: "B" },
			]}
			tableColumns={TABLE_COLUMNS}
			title="测试折线图"
			{...overrides}
		/>
	);
}

it("renders one themed line per series with distinct colors", async () => {
	const { container } = renderLineSeries();
	const areas = await within(container).findAllByTestId("area");
	expect(areas).toHaveLength(2);
	const strokes = areas.map((a) => a.getAttribute("data-stroke"));
	expect(new Set(strokes).size).toBe(2);
	expect(areas.map((a) => a.textContent)).toEqual(
		expect.arrayContaining(["A", "B"])
	);
});

it("renders as a plain line (no fill) by default, and filled when area is set", async () => {
	const { container: lineContainer } = renderLineSeries();
	const lineAreas = await within(lineContainer).findAllByTestId("area");
	for (const a of lineAreas) {
		expect(Number(a.getAttribute("data-fill-opacity"))).toBe(0);
	}

	const { container: areaContainer } = renderLineSeries({ area: true });
	const filledAreas = await within(areaContainer).findAllByTestId("area");
	for (const a of filledAreas) {
		expect(Number(a.getAttribute("data-fill-opacity"))).toBeGreaterThan(0);
	}
});

it("shows no Series chips for a single-series chart", async () => {
	const { container } = renderLineSeries({
		series: [{ key: "a", label: "A" }],
	});
	await within(container).findAllByTestId("area");
	expect(within(container).queryByRole("button", { name: "A" })).toBeNull();
});

it("hides a line when its Series chip is toggled off, keeping at least one", async () => {
	const { container } = renderLineSeries();
	await within(container).findAllByTestId("area");
	const chipB = within(container).getByRole("button", {
		name: "B",
		pressed: true,
	});
	fireEvent.click(chipB);
	const areas = within(container).getAllByTestId("area");
	expect(areas).toHaveLength(1);
	expect(areas[0]?.textContent).toBe("A");

	// The last remaining series chip can't be deselected (min 1).
	const chipA = within(container).getByRole("button", {
		name: "A",
		pressed: true,
	});
	fireEvent.click(chipA);
	expect(within(container).getAllByTestId("area")).toHaveLength(1);
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
	const { container } = renderLineSeries({ defaultView: "table", periods });
	const table = container.querySelector("table") as HTMLElement;
	expect(within(table).queryByText("2024-01-01")).not.toBeNull();
	expect(within(table).queryByText("2024-01-02")).toBeNull();

	fireEvent.click(within(container).getByRole("button", { name: "01-02" }));
	expect(within(table).queryByText("2024-01-02")).not.toBeNull();
	expect(within(table).queryByText("2024-01-01")).toBeNull();
});

it("pivots between the chart and table view", async () => {
	const { container } = renderLineSeries();
	expect(await within(container).findAllByTestId("area")).toHaveLength(2);
	expect(container.querySelector("table")).toBeNull();

	fireEvent.click(within(container).getByRole("button", { name: "表" }));
	expect(container.querySelector("table")).not.toBeNull();

	fireEvent.click(within(container).getByRole("button", { name: "图" }));
	expect(await within(container).findAllByTestId("area")).toHaveLength(2);
});

it("renders a themed tooltip for Inspect, formatted via the default formatCompact", async () => {
	const { container } = renderLineSeries();
	const tooltip = await within(container).findByTestId("tooltip");
	expect(tooltip.getAttribute("data-formatted")).toBe("1.23万");
});
