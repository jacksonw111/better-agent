// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { MoneyFlowRowData } from "./finance-schemas-fe6";
import { MoneyFlowChart } from "./money-flow-chart";

// Same recharts stub convention as bar-series.test.tsx / data-table.test.tsx —
// jsdom's zero-size layout means recharts never lays out real ticks, so this
// asserts on the props BarSeriesChart wires up (fill/name/children), not
// recharts' own layout engine.
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

const ROWS: MoneyFlowRowData[] = [
	{
		date: "2024-03-04",
		largeNet: 200,
		mainNet: 500,
		mediumNet: -50,
		smallNet: -150,
		superNet: 300,
	},
	{
		date: "2024-03-05",
		largeNet: -150,
		mainNet: -400,
		mediumNet: 40,
		smallNet: 60,
		superNet: -250,
	},
];

it("renders nothing for an empty payload", () => {
	const { container } = render(<MoneyFlowChart data={[]} />);
	expect(container.firstChild).toBeNull();
});

it("colors the four buckets with distinct hues by default (fixes 四档全红)", async () => {
	const { container } = render(<MoneyFlowChart data={ROWS} />);
	const bars = await within(container).findAllByTestId("bar");
	expect(bars).toHaveLength(4);
	const fills = bars.map((b) => b.getAttribute("data-fill"));
	expect(new Set(fills).size).toBe(4);
	expect(bars.map((b) => b.textContent)).toEqual(
		expect.arrayContaining(["超大单", "大单", "中单", "小单"])
	);
});

it("isolating a bucket via its Filter chip switches it to sign coloring", async () => {
	const { container } = render(<MoneyFlowChart data={ROWS} />);
	await within(container).findAllByTestId("bar");
	for (const label of ["大单", "中单", "小单"]) {
		fireEvent.click(
			within(container).getByRole("button", { name: label, pressed: true })
		);
	}
	const bars = within(container).getAllByTestId("bar");
	expect(bars).toHaveLength(1);
	const cells = within(bars[0] as HTMLElement).getAllByTestId("cell");
	expect(cells).toHaveLength(ROWS.length);
	const fills = cells.map((c) => c.getAttribute("data-fill"));
	expect(new Set(fills).size).toBeGreaterThan(1);
});

it("shows the sign-colored 主力净流入 column in the table view", () => {
	const { container } = render(<MoneyFlowChart data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "表" }));
	const table = container.querySelector("table") as HTMLElement;
	const positive = within(table).getByText("500.00");
	const negative = within(table).getByText("-400.00");
	expect(positive.getAttribute("style")).toContain("color");
	expect(negative.getAttribute("style")).toContain("color");
	expect(positive.getAttribute("style")).not.toBe(
		negative.getAttribute("style")
	);
});
