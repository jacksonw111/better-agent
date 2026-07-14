// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import {
	SENTIMENT_BULL,
	UP_COLOR,
	VERDICT_TOP_DIVERGENCE,
} from "./chart-theme";
import { DivergenceCard } from "./divergence-card";
import type { DivergenceData } from "./finance-schemas-fe11";

const BASE: DivergenceData = {
	ticker: "AAPL",
	priceChange1d: 0.5,
	priceChange5d: 2.1,
	priceTrend: "rising",
	buzzScore: 42,
	sentimentScore: 7,
	bullishPct: 60,
	bearishPct: 40,
	sentimentNet: -1.5,
	sentimentTrend: "rising",
	signal: "顶背离",
	note: "价格创新高但舆情走弱",
};

/** jsdom normalizes inline color styles to `rgb(...)`. */
function hexToRgb(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

it("shows the VerdictPill with the signal's label and semantic color", () => {
	const { container } = render(<DivergenceCard data={BASE} />);
	const scope = within(container);
	const label = scope.getByText("顶背离 · 价涨情弱");
	const pill = label.closest("div") as HTMLElement;
	expect(pill.style.color).toBe(hexToRgb(VERDICT_TOP_DIVERGENCE));
});

it("falls back to the neutral chip when the signal has no verdict color", () => {
	const { container } = render(
		<DivergenceCard data={{ ...BASE, signal: "中性" }} />
	);
	const scope = within(container);
	const label = scope.getByText("中性");
	const pill = label.closest("div") as HTMLElement;
	expect(pill.style.color).toBe("");
	expect(pill.className).toContain("text-muted-foreground");
});

it("uses different color axes for price vs sentiment trend arrows", () => {
	const { container } = render(<DivergenceCard data={BASE} />);
	// Both trends are "rising" in BASE, so both render a TrendingUp <svg>;
	// price must use the price axis (UP_COLOR = 红涨), sentiment must use the
	// sentiment axis (SENTIMENT_BULL = 看多 emerald) — never the same color.
	const strokes = Array.from(container.querySelectorAll("svg")).map((svg) =>
		svg.getAttribute("stroke")
	);
	expect(strokes).toContain(UP_COLOR);
	expect(strokes).toContain(SENTIMENT_BULL);
	expect(UP_COLOR).not.toBe(SENTIMENT_BULL);
});

it("keeps raw figures hidden until Expand is toggled, then reveals them", () => {
	const { container } = render(<DivergenceCard data={BASE} />);
	const scope = within(container);

	expect(scope.queryByText("1日涨跌")).toBeNull();
	expect(scope.queryByText("看多%")).toBeNull();

	const toggle = scope.getByText("展开明细");
	fireEvent.click(toggle);

	expect(scope.getByText("1日涨跌")).toBeDefined();
	expect(scope.getByText("看多%")).toBeDefined();
	expect(scope.getByText("收起明细")).toBeDefined();

	fireEvent.click(scope.getByText("收起明细"));
	expect(scope.queryByText("1日涨跌")).toBeNull();
});

it("always shows the headline pill, compare columns, and note", () => {
	const { container } = render(<DivergenceCard data={BASE} />);
	const scope = within(container);
	expect(scope.getByText("价格")).toBeDefined();
	expect(scope.getByText("舆情")).toBeDefined();
	expect(scope.getByText("价格创新高但舆情走弱")).toBeDefined();
});
