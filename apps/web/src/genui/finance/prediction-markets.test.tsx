// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PredictionMarketData } from "./finance-schemas-fe9";
import { PredictionMarkets } from "./prediction-markets";

// Reduced-motion mocked so ProportionBar fills render synchronously at their
// final width instead of animating there — see proportion-bar.test.tsx for
// the rationale (this file only needs the final DOM shape).
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const VOLUME_RE = /成交量/;
const END_DATE_RE = /2026-01-01/;

const MARKET: PredictionMarketData = {
	id: "m1",
	question: "Will it rain tomorrow?",
	slug: "will-it-rain",
	endDate: "2026-01-01",
	volumeUsd: 12_345,
	liquidityUsd: 999,
	outcomes: [
		{ name: "No", probability: 0.3, livePrice: false },
		{ name: "Yes", probability: 0.7, livePrice: true },
	],
};

it("renders nothing for an empty payload", () => {
	const { container } = render(<PredictionMarkets markets={[]} />);
	expect(container.firstChild).toBeNull();
});

it("renders each outcome as a ProportionBar with its label and %", () => {
	const { container } = render(<PredictionMarkets markets={[MARKET]} />);
	const scope = within(container);
	expect(scope.getByText("Will it rain tomorrow?")).toBeDefined();
	expect(scope.getByText("Yes")).toBeDefined();
	expect(scope.getByText("No")).toBeDefined();
	expect(scope.getByText("70.0%")).toBeDefined();
	expect(scope.getByText("30.0%")).toBeDefined();
	// ProportionBar's track fill renders as an absolutely-positioned div.
	const fills = container.querySelectorAll("div.absolute");
	expect(fills.length).toBe(MARKET.outcomes.length);
});

it("sorts outcomes by probability descending (highest first)", () => {
	const { container } = render(<PredictionMarkets markets={[MARKET]} />);
	// Outcome labels are the first <span> inside each bar row.
	const labels = Array.from(container.querySelectorAll("span")).map(
		(el) => el.textContent
	);
	const yesIndex = labels.indexOf("Yes");
	const noIndex = labels.indexOf("No");
	expect(yesIndex).toBeGreaterThanOrEqual(0);
	expect(noIndex).toBeGreaterThan(yesIndex);
});

it("shows the live pulsing dot only for outcomes with livePrice", () => {
	const { container } = render(<PredictionMarkets markets={[MARKET]} />);
	const liveDots = container.querySelectorAll('[aria-label="实时"]');
	expect(liveDots.length).toBe(1);
});

it("shows volume and end date footer", () => {
	const { container } = render(<PredictionMarkets markets={[MARKET]} />);
	const scope = within(container);
	expect(scope.getByText(VOLUME_RE)).toBeDefined();
	expect(scope.getByText(END_DATE_RE)).toBeDefined();
});
