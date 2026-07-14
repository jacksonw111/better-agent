// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CandlestickChart } from "./candlestick-chart";
import type { CandleData } from "./finance-schemas";

const CANDLE_COUNT_SUBTITLE_RE = /^10 根 ·/;

// lightweight-charts draws to a real <canvas>, which jsdom doesn't support —
// chart-module.ts's loadChartModule is mocked so ChartCanvas's async build
// runs against a fake chart/series API instead of the real library. This
// test focuses on what candlestick-chart.tsx itself owns (the ControlStrip —
// Period range + MA chips — and the empty state), not the canvas internals
// (the MA math is unit-tested directly in candlestick-ma.test.ts).
function fakeSeries() {
	return {
		applyOptions: vi.fn(),
		// candlestick-canvas calls `candleSeries.priceScale().applyOptions(...)`
		// to keep candles clear of the volume band; the real lightweight-charts
		// series exposes priceScale(), so the fake must too or the async chart
		// build rejects.
		priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
		setData: vi.fn(),
	};
}

function fakeChart() {
	return {
		addSeries: vi.fn(() => fakeSeries()),
		priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
		remove: vi.fn(),
		subscribeCrosshairMove: vi.fn(),
		timeScale: vi.fn(() => ({
			fitContent: vi.fn(),
			setVisibleLogicalRange: vi.fn(),
		})),
	};
}

const createChart = vi.fn((..._args: unknown[]) => fakeChart());

vi.mock("./chart-module", () => ({
	loadChartModule: () =>
		Promise.resolve({
			CandlestickSeries: {},
			ColorType: { Solid: "solid" },
			HistogramSeries: {},
			LineSeries: {},
			createChart,
		}),
}));

vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

function candle(time: string): CandleData {
	return { close: 11, high: 12, low: 9, open: 10, time, volume: 1000 };
}

const SHORT_CANDLES: CandleData[] = Array.from({ length: 10 }, (_, i) =>
	candle(`2024-01-${String(i + 1).padStart(2, "0")}`)
);
const LONG_CANDLES: CandleData[] = Array.from({ length: 70 }, (_, i) =>
	candle(`d${i}`)
);

it("renders the empty state and no ControlStrip for zero candles", () => {
	const { container } = render(<CandlestickChart candles={[]} />);
	const scope = within(container);
	expect(scope.getByText("K线")).toBeDefined();
	expect(scope.getByText("暂无 K线数据")).toBeDefined();
	expect(scope.queryByRole("button", { name: "MA5" })).toBeNull();
	expect(scope.queryByRole("button", { name: "全部" })).toBeNull();
});

it("renders the candle-count subtitle and the range + MA controls", () => {
	const { container } = render(<CandlestickChart candles={SHORT_CANDLES} />);
	const scope = within(container);
	expect(scope.getByText(CANDLE_COUNT_SUBTITLE_RE)).toBeDefined();
	expect(scope.getByRole("button", { name: "近30" })).toBeDefined();
	expect(scope.getByRole("button", { name: "近60" })).toBeDefined();
	expect(scope.getByRole("button", { name: "全部" })).toBeDefined();
	expect(scope.getByRole("button", { name: "MA5" })).toBeDefined();
	expect(scope.getByRole("button", { name: "MA10" })).toBeDefined();
	expect(scope.getByRole("button", { name: "MA20" })).toBeDefined();
});

it("greys out ranges whose trailing window exceeds the candle count", () => {
	const { container } = render(<CandlestickChart candles={SHORT_CANDLES} />);
	const scope = within(container);
	const recent30 = scope.getByRole("button", {
		name: "近30",
	}) as HTMLButtonElement;
	const recent60 = scope.getByRole("button", {
		name: "近60",
	}) as HTMLButtonElement;
	const all = scope.getByRole("button", { name: "全部" }) as HTMLButtonElement;
	expect(recent30.disabled).toBe(true);
	expect(recent60.disabled).toBe(true);
	expect(all.disabled).toBe(false);
});

it("a range with enough candles is selectable and reflects the pressed state", () => {
	const { container } = render(<CandlestickChart candles={LONG_CANDLES} />);
	const scope = within(container);
	const recent30 = scope.getByRole("button", { name: "近30" });
	expect(recent30.getAttribute("aria-pressed")).toBe("false");
	fireEvent.click(recent30);
	expect(recent30.getAttribute("aria-pressed")).toBe("true");
});

it("MA chips start selected (all three overlays on by default) and toggle off", () => {
	const { container } = render(<CandlestickChart candles={SHORT_CANDLES} />);
	const scope = within(container);
	const ma5 = scope.getByRole("button", { name: "MA5" });
	expect(ma5.getAttribute("aria-pressed")).toBe("true");
	fireEvent.click(ma5);
	expect(ma5.getAttribute("aria-pressed")).toBe("false");
});

it("MA chips can all be deselected (zero-selected is allowed, unlike other Series chip groups)", () => {
	const { container } = render(<CandlestickChart candles={SHORT_CANDLES} />);
	const scope = within(container);
	for (const label of ["MA5", "MA10", "MA20"]) {
		fireEvent.click(scope.getByRole("button", { name: label }));
	}
	for (const label of ["MA5", "MA10", "MA20"]) {
		expect(
			scope.getByRole("button", { name: label }).getAttribute("aria-pressed")
		).toBe("false");
	}
});

it("mounts the lightweight-charts canvas via the mocked chart-module loader", async () => {
	render(<CandlestickChart candles={SHORT_CANDLES} />);
	await vi.waitFor(() => expect(createChart).toHaveBeenCalled());
});
