// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { MarginRowData } from "./finance-schemas-fe11";
import { MarginChart } from "./margin-chart";

// Same recharts stub convention as line-series.test.tsx — jsdom's zero-size
// layout means recharts never lays out real ticks, so this asserts on the
// props LineSeriesChart wires up (stroke/name), plus the Tooltip's actual
// `formatter` callback (captured and invoked here) to verify margin's
// CNY-scale `valueFormat` is wired through end to end.
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	return {
		...actual,
		Area: ({ name, stroke }: { name?: string; stroke?: string }) => (
			<div data-stroke={stroke ?? ""} data-testid="area">
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
				data-formatted={
					formatter ? String(formatter(1_499_222_864_079, "融资余额")[0]) : ""
				}
				data-testid="tooltip"
			/>
		),
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

const ROWS: MarginRowData[] = [
	{
		date: "2026-07-08",
		financingBalance: 1_499_222_864_079,
		financingBalanceRatio: 8.42,
		financingBuy: 21_345_678_901,
		securitiesBalance: 34_567_890_123,
		securitiesVolume: 1_234_567,
		totalBalance: 1_533_790_754_202,
	},
	{
		date: "2026-07-07",
		financingBalance: 1_480_000_000_000,
		financingBalanceRatio: 8.3,
		financingBuy: 20_000_000_000,
		securitiesBalance: 33_000_000_000,
		securitiesVolume: 1_100_000,
		totalBalance: 1_513_000_000_000,
	},
];

it("renders nothing for an empty payload", () => {
	const { container } = render(<MarginChart data={[]} />);
	expect(container.firstChild).toBeNull();
});

it("renders two distinctly-colored lines: 融资余额 and 融券余额", async () => {
	const { container } = render(<MarginChart data={ROWS} />);
	const areas = await within(container).findAllByTestId("area");
	expect(areas).toHaveLength(2);
	expect(areas.map((a) => a.textContent)).toEqual(
		expect.arrayContaining(["融资余额", "融券余额"])
	);
	const strokes = areas.map((a) => a.getAttribute("data-stroke"));
	expect(new Set(strokes).size).toBe(2);
});

it("toggles 融资/融券 via their Series chips", async () => {
	const { container } = render(<MarginChart data={ROWS} />);
	await within(container).findAllByTestId("area");
	fireEvent.click(
		within(container).getByRole("button", { name: "融券余额", pressed: true })
	);
	const areas = within(container).getAllByTestId("area");
	expect(areas).toHaveLength(1);
	expect(areas[0]?.textContent).toBe("融资余额");
});

it("formats the tooltip value at CNY scale (raw yuan → 万/亿/万亿, ¥-prefixed) with no extra unit scaling", async () => {
	const { container } = render(<MarginChart data={ROWS} />);
	const tooltip = await within(container).findByTestId("tooltip");
	// financingBalance 1_499_222_864_079 raw yuan → ¥1.50万亿 (the >=1e12
	// bucket), NOT ¥14,992,228,640.79万亿 or any further ×10⁴ multiplication —
	// margin's fields are already yuan-scale, unlike hsgt_flow's 万元 fields.
	expect(tooltip.getAttribute("data-formatted")).toBe("¥1.50万亿");
});

it("shows the correctly-scaled (unmultiplied) balance in the Pivot table", async () => {
	const { container } = render(<MarginChart data={ROWS} />);
	await within(container).findAllByTestId("area");
	fireEvent.click(within(container).getByRole("button", { name: "表" }));
	const table = container.querySelector("table") as HTMLElement;
	expect(within(table).queryByText("¥1.50万亿")).not.toBeNull();
	expect(within(table).queryByText("融资余额")).not.toBeNull();
	expect(within(table).queryByText("融券余额")).not.toBeNull();
});
