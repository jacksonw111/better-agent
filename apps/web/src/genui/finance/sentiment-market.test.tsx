// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MarketSentimentData } from "./finance-schemas-fe10";
import { DOWN_COLOR, UP_COLOR } from "./format";
import { SentimentMarket } from "./sentiment-market";

/** jsdom normalizes inline color/background-color styles to `rgb(...)`. */
function hexToRgb(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

// StatPanel port of finance_sentiment_market (design doc §8.11). Archetype
// mechanics (Expand toggle open/close) are covered by stat-panel.test.tsx;
// this asserts sentiment-market.tsx's own field mapping — the bull/bear
// SPLIT ProportionBar sourced from the sentiment axis (never the price
// axis's red/green), sentimentScore coloring, and the drivers table behind
// Expand.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

// Sentiment-axis hex from chart-theme.ts, converted to the rgb() form jsdom
// normalizes inline styles to.
const BULL_RGB = "rgb(16, 185, 129)"; // SENTIMENT_BULL #10b981
const BEAR_RGB = "rgb(244, 63, 94)"; // SENTIMENT_BEAR #f43f5e

const BASE: MarketSentimentData = {
	activeTickers: 120,
	bearishPct: 30,
	buzzScore: 72,
	bullishPct: 70,
	drivers: [
		{ buzzScore: 90, mentions: 500, sentimentScore: 0.6, ticker: "TSLA" },
	],
	mentions: 45_000,
	negativeCount: 300,
	neutralCount: 500,
	positiveCount: 900,
	sentimentScore: 0.3,
	trend: "rising",
};

function splitSegments(
	container: HTMLElement
): { color: string; width: string }[] {
	return Array.from(container.querySelectorAll("div.h-full")).map((el) => ({
		color: (el as HTMLElement).style.backgroundColor,
		width: (el as HTMLElement).style.width,
	}));
}

it("renders the header and always-visible headline figures", () => {
	const { container } = render(<SentimentMarket data={BASE} />);
	const scope = within(container);
	expect(scope.getByText("市场整体舆情")).toBeDefined();
	expect(scope.getByText("活跃标的")).toBeDefined();
	expect(scope.getByText("4.50万")).toBeDefined();
});

it("renders a bull/bear split ProportionBar sized by bullishPct/bearishPct, using the sentiment axis (not price red/green)", () => {
	const { container } = render(<SentimentMarket data={BASE} />);
	const segments = splitSegments(container);
	expect(segments).toEqual([
		{ color: BULL_RGB, width: "70%" },
		{ color: BEAR_RGB, width: "30%" },
	]);
	const colors = segments.map((s) => s.color);
	expect(colors).not.toContain(hexToRgb(UP_COLOR));
	expect(colors).not.toContain(hexToRgb(DOWN_COLOR));
});

it("shows the exact 看多/看空 percentages as text under the bar", () => {
	const { container } = render(<SentimentMarket data={BASE} />);
	const scope = within(container);
	expect(scope.getByText("看多 70%")).toBeDefined();
	expect(scope.getByText("看空 30%")).toBeDefined();
});

it("colors sentimentScore bull/bear/neutral by the sentiment axis", () => {
	// sentimentScore renders twice (lead StatGrid + the split bar's
	// valueLabel) — both instances must carry the sentiment-axis color.
	const { container: bullContainer } = render(
		<SentimentMarket data={{ ...BASE, sentimentScore: 0.6 }} />
	);
	const bullScores = within(bullContainer).getAllByText("0.60");
	expect(bullScores.length).toBeGreaterThan(0);
	for (const el of bullScores) {
		expect(el.style.color).toBe(BULL_RGB);
	}

	const { container: bearContainer } = render(
		<SentimentMarket data={{ ...BASE, sentimentScore: -0.6 }} />
	);
	const bearScores = within(bearContainer).getAllByText("-0.60");
	expect(bearScores.length).toBeGreaterThan(0);
	for (const el of bearScores) {
		expect(el.style.color).toBe(BEAR_RGB);
	}
});

it("keeps the driver table hidden until Expand is toggled, then reveals it", () => {
	const { container } = render(<SentimentMarket data={BASE} />);
	const scope = within(container);
	expect(scope.queryByText("TSLA")).toBeNull();

	fireEvent.click(scope.getByText("展开驱动标的"));
	expect(scope.getByText("TSLA")).toBeDefined();
	expect(scope.getByText("标的")).toBeDefined();
});

it("omits the Expand toggle entirely when there are no drivers", () => {
	const { container } = render(
		<SentimentMarket data={{ ...BASE, drivers: [] }} />
	);
	expect(within(container).queryByRole("button")).toBeNull();
});
