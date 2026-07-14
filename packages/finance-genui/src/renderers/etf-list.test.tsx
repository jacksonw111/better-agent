// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EtfList } from "./etf-list";

// Smoke test for finance_etf_list's `RankList` wiring (design doc §8.6).
// Archetype-level Sort/Filter/Expand is covered by rank-list.test.tsx; this
// only asserts etf-list.tsx's own field mapping (turnover as the headline
// metric proxy, price + change%) survived the port.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const ROWS = [
	{
		changePct: 1.2,
		code: "510300",
		name: "沪深300ETF",
		price: 3.9,
		turnover: 1_200_000_000,
		turnoverRate: 0.8,
		volume: 300_000_000,
	},
	{
		changePct: -0.4,
		code: "159915",
		name: "创业板ETF",
		price: 2.1,
		turnover: 400_000_000,
		turnoverRate: 0.5,
		volume: 190_000_000,
	},
];

it("renders every row's name, code, price, and change%", () => {
	const { container } = render(<EtfList data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("沪深300ETF")).toBeDefined();
	expect(scope.getByText("510300")).toBeDefined();
	expect(scope.getByText("创业板ETF")).toBeDefined();
	expect(scope.getByText("+1.20%")).toBeDefined();
	expect(scope.getByText("-0.40%")).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<EtfList data={[]} />);
	expect(container.textContent).toBe("");
});
