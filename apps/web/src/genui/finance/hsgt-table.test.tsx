// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { HsgtRowData } from "./finance-schemas";
import { HsgtTable } from "./hsgt-table";

const POSITIVE_HUGUTONG_RE = /5678\.90万/;
const NEGATIVE_GANGGUTONG_RE = /-¥2000\.00万/;
const NANXIANG_TOTAL_RE = /6913\.40万/;

// Same recharts stub convention as money-flow-chart.test.tsx / bar-series.test.tsx
// — jsdom's zero-size layout means recharts never lays out real ticks, so this
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

function row(overrides: Partial<HsgtRowData>): HsgtRowData {
	return {
		buyAmt: null,
		channel: "沪股通",
		direction: "north",
		indexChangeRate: null,
		leadStock: null,
		netAmt: null,
		sellAmt: null,
		tradeDate: "2026-07-08",
		...overrides,
	};
}

// Northbound (沪股通/深股通) netAmt is null on every row — undisclosed since
// 2024-08-19 — matching production data. Southbound channels carry real,
// mixed-sign values. "南向合计" rows are included to assert they're dropped
// (they'd double-count 港股通(沪) + 港股通(深) if charted alongside them).
const ROWS: HsgtRowData[] = [
	row({ channel: "沪股通", direction: "north", tradeDate: "2026-07-07" }),
	row({ channel: "深股通", direction: "north", tradeDate: "2026-07-07" }),
	row({
		channel: "港股通(沪)",
		direction: "south",
		netAmt: -2000,
		tradeDate: "2026-07-07",
	}),
	row({
		channel: "港股通(深)",
		direction: "south",
		netAmt: 500,
		tradeDate: "2026-07-07",
	}),
	row({
		channel: "南向合计",
		direction: "south",
		netAmt: -1500,
		tradeDate: "2026-07-07",
	}),
	row({ channel: "沪股通", direction: "north", tradeDate: "2026-07-08" }),
	row({ channel: "深股通", direction: "north", tradeDate: "2026-07-08" }),
	row({
		channel: "港股通(沪)",
		direction: "south",
		netAmt: 5678.9,
		tradeDate: "2026-07-08",
	}),
	row({
		channel: "港股通(深)",
		direction: "south",
		netAmt: 1234.5,
		tradeDate: "2026-07-08",
	}),
	row({
		channel: "南向合计",
		direction: "south",
		netAmt: 6913.4,
		tradeDate: "2026-07-08",
	}),
];

it("renders nothing for an empty payload", () => {
	const { container } = render(<HsgtTable data={[]} />);
	expect(container.firstChild).toBeNull();
});

it("renders the four channels as distinct-hue series/chips, excluding 南向合计", async () => {
	const { container } = render(<HsgtTable data={ROWS} />);
	const bars = await within(container).findAllByTestId("bar");
	expect(bars).toHaveLength(4);
	const fills = bars.map((b) => b.getAttribute("data-fill"));
	expect(new Set(fills).size).toBe(4);
	expect(bars.map((b) => b.textContent)).toEqual(
		expect.arrayContaining(["沪股通", "深股通", "港股通(沪)", "港股通(深)"])
	);
	for (const label of ["沪股通", "深股通", "港股通(沪)", "港股通(深)"]) {
		expect(within(container).getByRole("button", { name: label })).toBeTruthy();
	}
	expect(
		within(container).queryByRole("button", { name: "南向合计" })
	).toBeNull();
});

it("isolating 港股通(沪) via its Filter chip switches it to sign coloring", async () => {
	const { container } = render(<HsgtTable data={ROWS} />);
	await within(container).findAllByTestId("bar");
	for (const label of ["沪股通", "深股通", "港股通(深)"]) {
		fireEvent.click(
			within(container).getByRole("button", { name: label, pressed: true })
		);
	}
	const bars = within(container).getAllByTestId("bar");
	expect(bars).toHaveLength(1);
	const cells = within(bars[0] as HTMLElement).getAllByTestId("cell");
	expect(cells).toHaveLength(2);
	const fills = cells.map((c) => c.getAttribute("data-fill"));
	expect(new Set(fills).size).toBe(2);
});

it("Pivot switches to a table with sign-colored channel columns and the disclosure note", () => {
	const { container } = render(<HsgtTable data={ROWS} />);
	fireEvent.click(within(container).getByRole("button", { name: "表" }));
	const table = container.querySelector("table") as HTMLElement;
	const positive = within(table).getByText(POSITIVE_HUGUTONG_RE);
	const negative = within(table).getByText(NEGATIVE_GANGGUTONG_RE);
	expect(positive.getAttribute("style")).toContain("color");
	expect(negative.getAttribute("style")).toContain("color");
	expect(positive.getAttribute("style")).not.toBe(
		negative.getAttribute("style")
	);
	expect(within(table).queryByText(NANXIANG_TOTAL_RE)).toBeNull();
	expect(
		within(container).getByText("北向资金净流入自2024年8月19日起不再披露")
	).toBeTruthy();
});

it("shows the tooltip in chart view", async () => {
	const { container } = render(<HsgtTable data={ROWS} />);
	expect(await within(container).findByTestId("tooltip")).toBeTruthy();
});
