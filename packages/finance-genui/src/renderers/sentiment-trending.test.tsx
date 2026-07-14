// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SentimentTrending } from "./sentiment-trending";

// Smoke test for finance_sentiment_trending's `RankList` wiring (design doc
// §8.6/§9). Archetype-level Sort/Filter/Expand mechanics are covered by
// rank-list.test.tsx; this asserts sentiment-trending.tsx's own field
// mapping — buzz headline bar, ranking, and the bull/bear split bar that
// only appears once a row is expanded.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const ROWS = [
	{
		bearishPct: 22,
		buzzScore: 82,
		bullishPct: 61,
		mentions: 1500,
		name: "Tesla",
		sentimentScore: 0.34,
		ticker: "TSLA",
		trend: "rising",
		uniquePosts: 420,
	},
	{
		bearishPct: 10,
		buzzScore: 40,
		bullishPct: 70,
		mentions: 300,
		name: "Apple",
		sentimentScore: 0.9,
		ticker: "AAPL",
		trend: "falling",
		uniquePosts: 100,
	},
];

function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition bitmask check, standard DOM idiom.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

function barWidths(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("div.absolute")).map(
		(el) => (el as HTMLElement).style.width
	);
}

const BULLISH_HEADING_RE = /看多/;

it("renders every row's name, ticker, and buzz value, ranked by buzz descending", () => {
	const { container } = render(<SentimentTrending data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("Tesla")).toBeDefined();
	expect(scope.getByText("TSLA")).toBeDefined();
	expect(scope.getByText("Apple")).toBeDefined();
	expect(isBefore(scope.getByText("Tesla"), scope.getByText("Apple"))).toBe(
		true
	);
	// buzz headline bar: Tesla(82) is the set's max, Apple(40) scales relative to it.
	expect(barWidths(container)).toEqual(["100%", `${(40 / 82) * 100}%`]);
});

it("reorders rows when sorting by 情绪分 instead of buzz", () => {
	const { container } = render(<SentimentTrending data={ROWS} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "情绪分" }));
	// Apple's sentimentScore (0.9) > Tesla's (0.34).
	expect(isBefore(scope.getByText("Apple"), scope.getByText("Tesla"))).toBe(
		true
	);
});

it("reveals the bull/bear split and post counts only once a row is expanded", () => {
	const { container } = render(<SentimentTrending data={ROWS} />);
	const scope = within(container);
	expect(scope.queryByText(BULLISH_HEADING_RE)).toBeNull();
	fireEvent.click(scope.getByText("Tesla").closest("button") as HTMLElement);
	expect(scope.getByText("看多 61%")).toBeDefined();
	expect(scope.getByText("看空 22%")).toBeDefined();
	expect(scope.getByText("420.00 独立发帖")).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<SentimentTrending data={[]} />);
	expect(container.textContent).toBe("");
});
