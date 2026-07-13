// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { HolderCountRowData } from "./finance-schemas-fe12";
import { HolderCountChart } from "./holder-count-chart";

// Same recharts stub convention as line-series.test.tsx / money-flow-chart.
// test.tsx — jsdom's zero-size layout means recharts never lays out real
// ticks, so this asserts on the props LineSeriesChart wires up (fillOpacity/
// stroke/name), not recharts' own layout engine.
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	return {
		...actual,
		Area: ({
			fillOpacity,
			name,
			stroke,
		}: {
			fillOpacity?: number;
			name?: string;
			stroke?: string;
		}) => (
			<div
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

const ROWS: HolderCountRowData[] = [
	{
		avgFreeShares: 12_345,
		avgFreeSharesRatio: 0.0021,
		changeRatio: -3.2,
		endDate: "2024-06-30",
		totalHolders: 98_765,
	},
	{
		avgFreeShares: 12_500,
		avgFreeSharesRatio: 0.0022,
		changeRatio: 1.1,
		endDate: "2024-03-31",
		totalHolders: 100_200,
	},
];

it("renders nothing for an empty payload", () => {
	const { container } = render(<HolderCountChart data={[]} />);
	expect(container.firstChild).toBeNull();
});

it("renders a single filled line (area) with no Series chips (single series)", async () => {
	const { container } = render(<HolderCountChart data={ROWS} />);
	const areas = await within(container).findAllByTestId("area");
	expect(areas).toHaveLength(1);
	expect(Number(areas[0]?.getAttribute("data-fill-opacity"))).toBeGreaterThan(
		0
	);
	expect(
		within(container).queryByRole("button", { name: "股东户数" })
	).toBeNull();
});

it("shows the existing table columns (户数/较上期/户均流通股) in the Pivot table", async () => {
	const { container } = render(<HolderCountChart data={ROWS} />);
	await within(container).findAllByTestId("area");
	fireEvent.click(within(container).getByRole("button", { name: "表" }));
	const table = container.querySelector("table") as HTMLElement;
	expect(within(table).queryByText("户数")).not.toBeNull();
	expect(within(table).queryByText("较上期")).not.toBeNull();
	expect(within(table).queryByText("户均流通股")).not.toBeNull();
	// totalHolders: 98,765 → formatCompact crosses the 万 threshold (>= 1e4).
	expect(within(table).queryByText("9.88万")).not.toBeNull();
});

it("renders the 筹码集中 hint as the card subtitle", () => {
	const { container } = render(<HolderCountChart data={ROWS} />);
	expect(
		within(container).queryByText(
			"户数下降通常意味着筹码集中，一般视为利好信号"
		)
	).not.toBeNull();
});
