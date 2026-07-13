// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SentimentCompare } from "./sentiment-compare";

// Smoke test for finance_sentiment_compare's `RankList` wiring (design doc
// §8.6/§9 "每行 bull/bear ProportionBar"). Archetype-level Sort/Filter/Expand
// mechanics are covered by rank-list.test.tsx; this asserts
// sentiment-compare.tsx's own field mapping — the bull/bear SPLIT headline
// bar (via `metricSegments`, not a single-value tone bar), ranking by
// sentiment score, and the 看多/看空 secondary text.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

// Sentiment-axis hex from chart-theme.ts, converted to the rgb() form jsdom
// normalizes inline styles to.
const BULL_RGB = "rgb(16, 185, 129)"; // #10b981
const BEAR_RGB = "rgb(244, 63, 94)"; // #f43f5e

const ROWS = [
	{
		bearishPct: 20,
		bullishPct: 80,
		buzzScore: 30,
		mentions: 500,
		name: "Tesla",
		sentimentScore: 0.6,
		ticker: "TSLA",
		trend: "rising",
	},
	{
		bearishPct: 65,
		bullishPct: 35,
		buzzScore: 90,
		mentions: 900,
		name: "Apple",
		sentimentScore: -0.2,
		ticker: "AAPL",
		trend: "falling",
	},
];

function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition bitmask check, standard DOM idiom.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

const MENTIONS_RE = /提及/;

function splitSegments(
	container: HTMLElement
): { color: string; width: string }[] {
	return Array.from(container.querySelectorAll("div.h-full")).map((el) => ({
		color: (el as HTMLElement).style.backgroundColor,
		width: (el as HTMLElement).style.width,
	}));
}

it("renders every row's name and ticker, ranked by sentiment score descending", () => {
	const { container } = render(<SentimentCompare data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("Tesla")).toBeDefined();
	expect(scope.getByText("TSLA")).toBeDefined();
	expect(scope.getByText("Apple")).toBeDefined();
	// Tesla's sentimentScore (0.6) > Apple's (-0.2).
	expect(isBefore(scope.getByText("Tesla"), scope.getByText("Apple"))).toBe(
		true
	);
});

it("renders a bull/bear split bar (not a single-value fill) sized by bullishPct/bearishPct", () => {
	const { container } = render(<SentimentCompare data={ROWS} />);
	// Tesla: 80% bull, 20% bear. Apple: 35% bull, 65% bear.
	expect(splitSegments(container)).toEqual([
		{ color: BULL_RGB, width: "80%" },
		{ color: BEAR_RGB, width: "20%" },
		{ color: BULL_RGB, width: "35%" },
		{ color: BEAR_RGB, width: "65%" },
	]);
});

it("shows the exact 看多/看空 percentages as secondary text", () => {
	const { container } = render(<SentimentCompare data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("看多 80%")).toBeDefined();
	expect(scope.getByText("看空 20%")).toBeDefined();
	expect(scope.getByText("看多 35%")).toBeDefined();
	expect(scope.getByText("看空 65%")).toBeDefined();
});

it("reorders rows when sorting by 热度 instead of sentiment score", () => {
	const { container } = render(<SentimentCompare data={ROWS} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "热度" }));
	// Apple's buzzScore (90) > Tesla's (30).
	expect(isBefore(scope.getByText("Apple"), scope.getByText("Tesla"))).toBe(
		true
	);
});

it("reveals mentions and buzz only once a row is expanded", () => {
	const { container } = render(<SentimentCompare data={ROWS} />);
	const scope = within(container);
	expect(scope.queryByText(MENTIONS_RE)).toBeNull();
	fireEvent.click(scope.getByText("Tesla").closest("button") as HTMLElement);
	expect(scope.getByText("500.00 提及 · 热度 30%")).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<SentimentCompare data={[]} />);
	expect(container.textContent).toBe("");
});
