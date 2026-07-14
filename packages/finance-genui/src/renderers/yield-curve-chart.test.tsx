// @vitest-environment jsdom

import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { YieldPointData } from "./finance-schemas-fe6";
import { YieldCurveChart } from "./yield-curve-chart";

// Same recharts stub convention as line-series.test.tsx / margin-chart.
// test.tsx — jsdom's zero-size layout means recharts never lays out real
// ticks, so this asserts on the props LineSeriesChart wires up: `AreaChart`'s
// `data` (to check the tenor x-axis is sorted short→long, the case a
// reviewer flagged — line-series-chart.tsx's own `orderedForChart` only
// re-sorts a numeric/date categoryKey, and a tenor label like "1M"/"10Y"
// matches neither, so it silently falls back to whatever row order
// yield-curve-chart.tsx itself hands it), plus `Area`'s stroke/name and
// `Tooltip`'s `formatter` callback (captured and invoked here).
vi.mock("recharts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("recharts")>();
	return {
		...actual,
		Area: ({ name, stroke }: { name?: string; stroke?: string }) => (
			<div data-stroke={stroke ?? ""} data-testid="area">
				{name}
			</div>
		),
		AreaChart: ({
			children,
			data,
		}: {
			children?: ReactNode;
			data?: { __category?: string }[];
		}) => (
			<div data-categories={(data ?? []).map((d) => d.__category).join(",")}>
				{children}
			</div>
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
				data-formatted={formatter ? String(formatter(4.32, "x")[0]) : ""}
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

// Deliberately out of tenor order (mirrors a payload arriving in whatever
// order the source API returned its per-tenor fetches) so ordering tests
// actually exercise the sort rather than passing by accident.
const SINGLE_DATE_UNORDERED: YieldPointData[] = [
	{ date: "2026-07-07", seriesId: "DGS10", tenor: "10Y", yield: 4.32 },
	{ date: "2026-07-07", seriesId: "DGS1MO", tenor: "1M", yield: 5.1 },
	{ date: "2026-07-07", seriesId: "DGS1", tenor: "1Y", yield: 4.6 },
	{ date: "2026-07-07", seriesId: "DGS3MO", tenor: "3M", yield: 5.05 },
];

const MULTI_DATE: YieldPointData[] = [
	{ date: "2026-07-07", seriesId: "DGS10", tenor: "10Y", yield: 4.32 },
	{ date: "2026-07-07", seriesId: "DGS1MO", tenor: "1M", yield: 5.1 },
	{ date: "2026-06-30", seriesId: "DGS10", tenor: "10Y", yield: 4.4 },
	{ date: "2026-06-30", seriesId: "DGS1MO", tenor: "1M", yield: 5.2 },
];

it("renders nothing for an empty payload", () => {
	const { container } = render(<YieldCurveChart data={[]} />);
	expect(container.firstChild).toBeNull();
});

it("orders the tenor x-axis short→long, not the payload's own point order", async () => {
	const { container } = render(
		<YieldCurveChart data={SINGLE_DATE_UNORDERED} />
	);
	await within(container).findAllByTestId("area");
	const chart = container.querySelector("[data-categories]") as HTMLElement;
	expect(chart.getAttribute("data-categories")).toBe("1M,3M,1Y,10Y");
});

it("renders one overlaid line per date, with Compare chips to toggle them", async () => {
	const { container } = render(<YieldCurveChart data={MULTI_DATE} />);
	const areas = await within(container).findAllByTestId("area");
	expect(areas).toHaveLength(2);
	const strokes = areas.map((a) => a.getAttribute("data-stroke"));
	expect(new Set(strokes).size).toBe(2);

	fireEvent.click(
		within(container).getByRole("button", {
			name: "2026-06-30",
			pressed: true,
		})
	);
	const remaining = within(container).getAllByTestId("area");
	expect(remaining).toHaveLength(1);
	expect(remaining[0]?.textContent).toBe("2026-07-07");
});

it("renders a single curve with no Compare chips for a single-date payload", async () => {
	const { container } = render(
		<YieldCurveChart data={SINGLE_DATE_UNORDERED} />
	);
	const areas = await within(container).findAllByTestId("area");
	expect(areas).toHaveLength(1);
	expect(
		within(container).queryByRole("button", { name: "2026-07-07" })
	).toBeNull();
});

it("renders a themed tooltip formatting the yield as a percentage", async () => {
	const { container } = render(
		<YieldCurveChart data={SINGLE_DATE_UNORDERED} />
	);
	const tooltip = await within(container).findByTestId("tooltip");
	expect(tooltip.getAttribute("data-formatted")).toBe("4.3%");
});
