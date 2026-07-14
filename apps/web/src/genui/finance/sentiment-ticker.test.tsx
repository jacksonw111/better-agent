// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TickerSentimentData } from "./finance-schemas-fe10";
import { DOWN_COLOR, UP_COLOR } from "./format";
import { SentimentTicker } from "./sentiment-ticker";

// StatPanel port of finance_sentiment_ticker (design doc §8.11). Archetype
// mechanics (Expand toggle open/close) are covered by stat-panel.test.tsx;
// this asserts sentiment-ticker.tsx's own field mapping — the bull/bear
// SPLIT ProportionBar sourced from the sentiment axis (never the price
// axis's red/green), sentimentScore coloring, and the daily-trend Sparkline
// behind Expand.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

/** jsdom normalizes inline color/background-color styles to `rgb(...)`. */
function hexToRgb(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

// Sentiment-axis hex from chart-theme.ts, converted to the rgb() form jsdom
// normalizes inline styles to.
const BULL_RGB = "rgb(16, 185, 129)"; // SENTIMENT_BULL #10b981
const BEAR_RGB = "rgb(244, 63, 94)"; // SENTIMENT_BEAR #f43f5e

const BASE: TickerSentimentData = {
	bearishPct: 25,
	buzzScore: 55,
	bullishPct: 75,
	dailyTrend: [
		{
			bearishPct: 20,
			bullishPct: 80,
			buzzScore: 40,
			date: "2024-01-01",
			mentions: 100,
			sentimentScore: 0.1,
		},
		{
			bearishPct: 30,
			bullishPct: 70,
			buzzScore: 60,
			date: "2024-01-02",
			mentions: 150,
			sentimentScore: 0.2,
		},
	],
	found: true,
	mentions: 800,
	name: "Tesla",
	negativeCount: 40,
	neutralCount: 60,
	periodDays: 7,
	positiveCount: 200,
	sentimentScore: 0.4,
	ticker: "TSLA",
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

it("renders the ticker + name title and trend·periodDays subtitle", () => {
	const { container } = render(<SentimentTicker data={BASE} />);
	const scope = within(container);
	expect(scope.getByText("TSLA Tesla")).toBeDefined();
	expect(scope.getByText("rising · 7天")).toBeDefined();
});

it("renders a bull/bear split ProportionBar sized by bullishPct/bearishPct, using the sentiment axis (not price red/green)", () => {
	const { container } = render(<SentimentTicker data={BASE} />);
	const segments = splitSegments(container);
	expect(segments).toEqual([
		{ color: BULL_RGB, width: "75%" },
		{ color: BEAR_RGB, width: "25%" },
	]);
	const colors = segments.map((s) => s.color);
	expect(colors).not.toContain(hexToRgb(UP_COLOR));
	expect(colors).not.toContain(hexToRgb(DOWN_COLOR));
});

it("shows the exact 看多/看空 percentages as text under the bar", () => {
	const { container } = render(<SentimentTicker data={BASE} />);
	const scope = within(container);
	expect(scope.getByText("看多 75%")).toBeDefined();
	expect(scope.getByText("看空 25%")).toBeDefined();
});

it("colors sentimentScore bull/bear/neutral by the sentiment axis", () => {
	// sentimentScore renders twice (lead StatGrid + the split bar's
	// valueLabel) — both instances must carry the sentiment-axis color.
	const { container: bullContainer } = render(
		<SentimentTicker data={{ ...BASE, sentimentScore: 0.6 }} />
	);
	const bullScores = within(bullContainer).getAllByText("0.60");
	expect(bullScores.length).toBeGreaterThan(0);
	for (const el of bullScores) {
		expect(el.style.color).toBe(BULL_RGB);
	}

	const { container: bearContainer } = render(
		<SentimentTicker data={{ ...BASE, sentimentScore: -0.6 }} />
	);
	const bearScores = within(bearContainer).getAllByText("-0.60");
	expect(bearScores.length).toBeGreaterThan(0);
	for (const el of bearScores) {
		expect(el.style.color).toBe(BEAR_RGB);
	}
});

it("keeps the daily-trend Sparkline hidden until Expand is toggled, then reveals it", () => {
	// TrendIcon (lucide, in the always-visible headline) also renders an
	// <svg>, so scope to the Sparkline's own <polyline> instead.
	const { container } = render(<SentimentTicker data={BASE} />);
	const scope = within(container);
	expect(container.querySelector("polyline")).toBeNull();

	fireEvent.click(scope.getByText("展开近期趋势"));
	expect(container.querySelector("polyline")).not.toBeNull();
});

it("omits the Expand toggle entirely when there is no daily trend", () => {
	const { container } = render(
		<SentimentTicker data={{ ...BASE, dailyTrend: [] }} />
	);
	expect(within(container).queryByRole("button")).toBeNull();
});

it("renders a muted '无数据' note instead of a full panel when found is false", () => {
	const { container } = render(
		<SentimentTicker data={{ ...BASE, found: false }} />
	);
	const scope = within(container);
	expect(scope.getByText("无数据")).toBeDefined();
	expect(scope.queryByText("看多 75%")).toBeNull();
});
