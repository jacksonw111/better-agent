// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { DOWN_COLOR, UP_COLOR } from "./chart-theme";
import type { TechnicalData } from "./finance-schemas";
import { TechnicalPanel } from "./technical-panel";

const ARBITRARY_HEX_CLASS_RE = /\[#/;

/** jsdom normalizes inline color/background-color styles to `rgb(...)`. */
function hexToRgb(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

const BASE: TechnicalData = {
	asOf: "2024-01-15",
	boll: { lower: 170, mid: 180, upper: 190 },
	close: 189.5,
	ema12: 186,
	ema26: 182,
	kdj: { d: 60, j: 90, k: 70 },
	ma5: 188,
	ma10: 185,
	ma20: 180,
	ma60: 175,
	macd: { dea: 0.3, dif: 0.5, macd: 0.4 },
	period: "daily",
	rsi14: 50,
	symbol: "AAPL",
};

it("shows 均线/MACD/RSI14 always-visible and keeps KDJ · BOLL behind Expand", () => {
	const { container } = render(<TechnicalPanel data={BASE} />);
	const scope = within(container);

	expect(scope.getByText("均线")).toBeDefined();
	expect(scope.getByText("DIF")).toBeDefined();
	expect(scope.getByText("RSI14")).toBeDefined();
	expect(scope.queryByText("K")).toBeNull();
	expect(scope.queryByText("上轨")).toBeNull();

	fireEvent.click(scope.getByText("展开KDJ · BOLL"));

	expect(scope.getByText("K")).toBeDefined();
	expect(scope.getByText("上轨")).toBeDefined();
});

it("colors MACD by sign (red positive / green negative, 红涨绿跌) via StatGrid's tone class", () => {
	const { container } = render(
		<TechnicalPanel data={{ ...BASE, macd: { dea: 0, dif: 0, macd: -0.4 } }} />
	);
	const scope = within(container);
	const macdValue = scope.getByText("-0.400");
	expect(macdValue.className).toContain(`text-[${DOWN_COLOR}]`);
});

it("highlights RSI14 oversold (<30) in green and overbought (>70) in red via inline style, never a hardcoded/arbitrary class", () => {
	const { container: oversoldContainer } = render(
		<TechnicalPanel data={{ ...BASE, rsi14: 20 }} />
	);
	const oversoldFill = oversoldContainer.querySelector(
		".h-full.rounded-full"
	) as HTMLElement;
	expect(oversoldFill.style.backgroundColor).toBe(hexToRgb(DOWN_COLOR));
	expect(oversoldFill.className).not.toMatch(ARBITRARY_HEX_CLASS_RE);

	const { container: overboughtContainer } = render(
		<TechnicalPanel data={{ ...BASE, rsi14: 85 }} />
	);
	const overboughtFill = overboughtContainer.querySelector(
		".h-full.rounded-full"
	) as HTMLElement;
	expect(overboughtFill.style.backgroundColor).toBe(hexToRgb(UP_COLOR));
	expect(overboughtFill.className).not.toMatch(ARBITRARY_HEX_CLASS_RE);
});

it("leaves RSI14 neutral (30–70) uncolored", () => {
	const { container } = render(
		<TechnicalPanel data={{ ...BASE, rsi14: 50 }} />
	);
	const fill = container.querySelector(".h-full.rounded-full") as HTMLElement;
	expect(fill.style.backgroundColor).toBe("");
	expect(fill.className).toContain("bg-foreground/30");
});

it("renders '—' for every indicator when the whole family is null", () => {
	const { container } = render(
		<TechnicalPanel
			data={{
				...BASE,
				boll: null,
				kdj: null,
				macd: null,
				ma5: null,
				rsi14: null,
			}}
		/>
	);
	const scope = within(container);
	fireEvent.click(scope.getByText("展开KDJ · BOLL"));
	expect(scope.getAllByText("—").length).toBeGreaterThan(0);
});
